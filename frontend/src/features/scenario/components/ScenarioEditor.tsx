import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { fetchScenario, saveScenario } from "../api";
import { readScenarioDraft } from "../draftStorage";
import {
  cloneScenarioRow,
  createEmptyScenarioRow,
  createSegmentUid,
  withOrderIndexes,
} from "../rowIdentity";
import {
  BLOCK_OPTIONS,
  DEFAULT_EDITOR_COLUMN_WIDTHS,
  EDITOR_COLUMNS,
  EDITOR_COLUMN_WIDTHS_STORAGE_KEY,
  FILL_COLOR_OPTIONS,
  FONT_OPTIONS,
  MIN_EDITOR_COLUMN_WIDTHS,
  blockTypeTone,
  loadEditorColumnWidths,
  preferredFocusTarget,
  scenarioFormatting,
  setScenarioFormatting,
} from "../scenarioTableModel";
import type { ScenarioFormattingTarget, ScenarioRow, ScenarioSnapshot } from "../types";
import { EditLeaseHandoffCoordinator, useEditLease } from "../useEditLease";
import { useScenarioAutosave } from "../useScenarioAutosave";
import AutosaveStatus from "./AutosaveStatus";
import CaptionPanelsStatus from "./CaptionPanelsStatus";
import EditLeaseNotice from "./EditLeaseNotice";
import ScenarioRowComponent, { type ScenarioFormatScope } from "./ScenarioRow";
import { fetchWorkflow } from "../../workflow/api";
import WorkflowActions from "../../workflow/components/WorkflowActions";
import WorkflowSummary from "../../workflow/components/WorkflowSummary";
import type { WorkflowReadModel } from "../../workflow/types";

interface Props {
  storyId: number;
  userId: number;
  leaseCoordinator?: EditLeaseHandoffCoordinator;
  onScenarioLoaded?: (revision: number) => void;
}

function ensureEditableRows(rows: ScenarioRow[]): ScenarioRow[] {
  return withOrderIndexes(rows.length ? rows : [createEmptyScenarioRow(1)]);
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  const tagName = element?.tagName.toLowerCase() || "";
  return ["input", "textarea", "select", "button"].includes(tagName)
    || Boolean(element?.isContentEditable)
    || Boolean(element?.closest(".rich-text-field"));
}

export default function ScenarioEditor({
  storyId,
  userId,
  leaseCoordinator,
  onScenarioLoaded,
}: Props) {
  const [snapshot, setSnapshot] = useState<ScenarioSnapshot | null>(null);
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowReadModel | null>(null);
  const [workflowError, setWorkflowError] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [formatScope, setFormatScope] = useState<ScenarioFormatScope | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    segmentUid: string;
    target: ReturnType<typeof preferredFocusTarget>;
    nonce: number;
  } | null>(null);
  const [columnWidths, setColumnWidths] = useState(loadEditorColumnWidths);
  const rowsRef = useRef<ScenarioRow[]>([]);
  const focusRequestNonceRef = useRef(0);
  const columnResizeCleanupRef = useRef<(() => void) | null>(null);
  const workflowRequestRef = useRef(0);
  const loadedWorkflowStoryRef = useRef<number | null>(null);
  const currentWorkflowStoryRef = useRef(storyId);
  currentWorkflowStoryRef.current = storyId;
  const lease = useEditLease(storyId, leaseCoordinator);
  const persistScenario = useCallback(
    (payload: Parameters<typeof saveScenario>[1]) => saveScenario(storyId, payload),
    [storyId],
  );
  const loadWorkflow = useCallback(async () => {
    const requestId = workflowRequestRef.current + 1;
    workflowRequestRef.current = requestId;
    try {
      const nextWorkflow = await fetchWorkflow(storyId);
      if (requestId !== workflowRequestRef.current || currentWorkflowStoryRef.current !== storyId) {
        return;
      }
      setWorkflow(nextWorkflow);
      setWorkflowError("");
    } catch (requestError) {
      if (requestId !== workflowRequestRef.current || currentWorkflowStoryRef.current !== storyId) {
        return;
      }
      setWorkflowError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить редакционный процесс",
      );
    }
  }, [storyId]);

  const autosave = useScenarioAutosave({
    storyId,
    userId,
    initialRevision: snapshot?.scenario.revision ?? 0,
    ensureLease: lease.acquire,
    save: persistScenario,
    resumeVersion: lease.resumeVersion,
    onAcknowledgedRevision: () => { void loadWorkflow(); },
  });

  useEffect(() => {
    if (loadedWorkflowStoryRef.current === storyId) return;
    loadedWorkflowStoryRef.current = storyId;
    setWorkflow(null);
    setWorkflowError("");
    void loadWorkflow();
  }, [loadWorkflow, storyId]);

  useEffect(() => {
    let active = true;
    void fetchScenario(storyId)
      .then((next) => {
        if (!active) return;
        const draft = readScenarioDraft(storyId, userId);
        const initialRows = draft?.revision === next.scenario.revision
          ? draft.rows
          : next.scenario.rows;
        const ordered = ensureEditableRows(initialRows);
        rowsRef.current = ordered;
        setRows(ordered);
        setSelectedRowIds([]);
        setFormatScope(null);
        setFocusRequest(null);
        setSnapshot(next);
        setLoadError("");
        onScenarioLoaded?.(next.scenario.revision);
      })
      .catch((requestError) => {
        if (active) {
          setLoadError(
            requestError instanceof Error ? requestError.message : "Не удалось загрузить сценарий",
          );
        }
      });
    return () => { active = false; };
  }, [onScenarioLoaded, storyId, userId]);

  const mutate = useCallback((updater: (current: ScenarioRow[]) => ScenarioRow[]) => {
    if (!snapshot || snapshot.edit.state === "held" || snapshot.edit.state === "archived") return;
    const next = ensureEditableRows(updater(rowsRef.current));
    rowsRef.current = next;
    setRows(next);
    lease.touch();
    void lease.acquire().catch(() => undefined);
    autosave.scheduleSave(next);
  }, [autosave, lease, snapshot]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (autosave.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [autosave]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        EDITOR_COLUMN_WIDTHS_STORAGE_KEY,
        JSON.stringify(columnWidths),
      );
    } catch {
      // Column widths are a convenience and must not break the editor.
    }
  }, [columnWidths]);

  useEffect(() => () => {
    columnResizeCleanupRef.current?.();
  }, []);

  const readOnly = snapshot?.edit.state === "held" || snapshot?.edit.state === "archived";

  const selectRow = useCallback((segmentUid: string, multi: boolean, force = false) => {
    setSelectedRowIds((previous) => {
      if (force) {
        return previous.length === 1 && previous[0] === segmentUid
          ? previous
          : [segmentUid];
      }
      if (!multi) {
        return previous.length === 1 && previous[0] === segmentUid ? [] : [segmentUid];
      }
      const next = previous.includes(segmentUid)
        ? previous.filter((item) => item !== segmentUid)
        : [...previous, segmentUid];
      const order = new Map(
        rowsRef.current.map((row, index) => [row.segment_uid, index]),
      );
      return next.sort((left, right) =>
        (order.get(left) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(right) ?? Number.MAX_SAFE_INTEGER));
    });
  }, []);

  const requestEditorFocus = useCallback((
    segmentUid: string,
    target: ReturnType<typeof preferredFocusTarget>,
  ) => {
    focusRequestNonceRef.current += 1;
    setFocusRequest({
      segmentUid,
      target,
      nonce: focusRequestNonceRef.current,
    });
  }, []);

  const deleteSelectedRows = useCallback(() => {
    if (readOnly || selectedRowIds.length === 0) return;
    const selected = new Set(selectedRowIds);
    const firstSelectedIndex = rowsRef.current.findIndex((row) =>
      selected.has(row.segment_uid));
    const remaining = ensureEditableRows(
      rowsRef.current.filter((row) => !selected.has(row.segment_uid)),
    );
    const nextRow = remaining[Math.min(
      Math.max(firstSelectedIndex, 0),
      remaining.length - 1,
    )];
    mutate(() => remaining);
    setSelectedRowIds([nextRow.segment_uid]);
    requestEditorFocus(nextRow.segment_uid, preferredFocusTarget(nextRow.block_type));
  }, [mutate, readOnly, requestEditorFocus, selectedRowIds]);

  const addBlock = useCallback((blockType: ScenarioRow["block_type"]) => {
    if (readOnly) return;
    const selected = new Set(selectedRowIds);
    mutate((current) => {
      const lastSelectedIndex = current.reduce(
        (last, row, index) => selected.has(row.segment_uid) ? index : last,
        -1,
      );
      const insertionIndex = lastSelectedIndex >= 0 ? lastSelectedIndex + 1 : current.length;
      const next = [...current];
      const created = { ...createEmptyScenarioRow(insertionIndex + 1), block_type: blockType };
      next.splice(insertionIndex, 0, created);
      setSelectedRowIds([created.segment_uid]);
      requestEditorFocus(created.segment_uid, preferredFocusTarget(blockType));
      return next;
    });
  }, [mutate, readOnly, requestEditorFocus, selectedRowIds]);

  const applyFormatting = useCallback((
    patch: Partial<ScenarioFormattingTarget>,
    options?: { reset?: boolean; collapseSelection?: boolean },
  ) => {
    if (!formatScope || formatScope.applySelection(patch, options)) return;
    const targetIds = new Set(
      selectedRowIds.length ? selectedRowIds : [formatScope.segmentUid],
    );
    let nextScopeConfig = formatScope.config;
    mutate((current) => current.map((row) => {
      if (!targetIds.has(row.segment_uid)) return row;
      const next = setScenarioFormatting(row, formatScope.target, patch);
      if (next.segment_uid === formatScope.segmentUid) {
        nextScopeConfig = scenarioFormatting(next, formatScope.target);
      }
      return next;
    }));
    setFormatScope((current) => current && current.segmentUid === formatScope.segmentUid
      ? { ...current, config: nextScopeConfig }
      : current);
  }, [formatScope, mutate, selectedRowIds]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (readOnly || isEditableKeyboardTarget(event.target) || selectedRowIds.length === 0) return;
      const selectedIndex = rowsRef.current.findIndex(
        (row) => row.segment_uid === selectedRowIds[selectedRowIds.length - 1],
      );
      if (selectedIndex < 0) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        const source = rowsRef.current[selectedIndex];
        const duplicate = cloneScenarioRow(source);
        duplicate.segment_uid = createSegmentUid();
        mutate((current) => [
          ...current.slice(0, selectedIndex + 1),
          duplicate,
          ...current.slice(selectedIndex + 1),
        ]);
        setSelectedRowIds([duplicate.segment_uid]);
        requestEditorFocus(
          duplicate.segment_uid,
          preferredFocusTarget(duplicate.block_type),
        );
      } else if ((event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectedRows();
      } else if (event.key === "Enter") {
        event.preventDefault();
        addBlock(rowsRef.current[selectedIndex].block_type);
      } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        const targetIndex = selectedIndex + direction;
        if (targetIndex < 0 || targetIndex >= rowsRef.current.length) return;
        if (event.shiftKey) {
          const selectedRow = rowsRef.current[selectedIndex];
          mutate((current) => {
            const next = [...current];
            [next[selectedIndex], next[targetIndex]] = [next[targetIndex], next[selectedIndex]];
            return next;
          });
          requestEditorFocus(
            selectedRow.segment_uid,
            formatScope?.segmentUid === selectedRow.segment_uid
              ? formatScope.target
              : preferredFocusTarget(selectedRow.block_type),
          );
        } else {
          const targetRow = rowsRef.current[targetIndex];
          setSelectedRowIds([targetRow.segment_uid]);
          requestEditorFocus(
            targetRow.segment_uid,
            preferredFocusTarget(targetRow.block_type),
          );
        }
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [
    addBlock,
    deleteSelectedRows,
    formatScope,
    mutate,
    readOnly,
    requestEditorFocus,
    selectedRowIds,
  ]);

  const handleColumnResizeStart = (
    columnKey: keyof typeof columnWidths,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    columnResizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = columnWidths[columnKey];
    const handlePointerMove = (moveEvent: PointerEvent) => {
      setColumnWidths((previous) => ({
        ...previous,
        [columnKey]: Math.max(
          MIN_EDITOR_COLUMN_WIDTHS[columnKey],
          startWidth + moveEvent.clientX - startX,
        ),
      }));
    };
    const cleanup = () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      if (columnResizeCleanupRef.current === cleanup) {
        columnResizeCleanupRef.current = null;
      }
    };
    columnResizeCleanupRef.current = cleanup;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  };

  if (loadError) return <p className="error" role="alert">{loadError}</p>;
  if (!snapshot) return <p className="muted" role="status">Загрузка сценария...</p>;

  return (
    <section className="scenario-editor" aria-label="Редактор сценария">
      <div className="scenario-editor-heading">
        <h2>{snapshot.story.title || "Сценарий"}</h2>
        <AutosaveStatus status={autosave.status} error={autosave.error} />
      </div>
      <EditLeaseNotice edit={snapshot.edit} error={lease.error} />
      {workflow ? (
        <>
          <WorkflowSummary workflow={workflow} />
          <WorkflowActions
            workflow={workflow}
            revision={autosave.revision}
            disabled={autosave.status !== "idle"}
            beforeAction={lease.release}
            onRefresh={loadWorkflow}
          />
        </>
      ) : null}
      {workflowError ? (
        <p className="error workflow-load-error" role="alert">
          {workflowError}{" "}
          <button type="button" onClick={() => void loadWorkflow()}>
            Повторить загрузку редакционного процесса
          </button>
        </p>
      ) : null}
      {snapshot.captionpanels ? (
        <CaptionPanelsStatus storyId={storyId} state={snapshot.captionpanels} />
      ) : null}

      {!readOnly ? (
        <div className="editor-toolbar-sticky">
          <div className="editor-toolbar-card">
            <div className="editor-table-toolbar">
              <button
                type="button"
                className="danger"
                disabled={selectedRowIds.length === 0}
                onClick={deleteSelectedRows}
              >
                Удалить выбранные
              </button>
              <div className="editor-add-block-buttons editor-add-block-buttons-inline">
                {BLOCK_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    className={`editor-add-block-button editor-add-block-button-${blockTypeTone(value)}`}
                    onClick={() => addBlock(value)}
                  >
                    + {label}
                  </button>
                ))}
              </div>
            </div>
            {formatScope ? (
              <div className="editor-format-toolbar" role="toolbar" aria-label="Форматирование">
                <div className="editor-format-toolbar-head">
                  <strong>Форматирование</strong>
                  <span className="small muted">
                    Строка {formatScope.rowIndex + 1}: {formatScope.label}
                  </span>
                </div>
                <div className="editor-format-toolbar-row editor-format-toolbar-row-inline">
                  <div className="editor-format-inline-group">
                    <span className="editor-format-inline-label">Шрифт</span>
                    <select
                      className="editor-format-font-select"
                      aria-label={`Шрифт для ${formatScope.label} блока ${formatScope.rowIndex + 1}`}
                      value={formatScope.config.font_family || "PT Sans"}
                      onChange={(event) => applyFormatting({ font_family: event.target.value })}
                    >
                      {FONT_OPTIONS.map((font) => <option key={font}>{font}</option>)}
                    </select>
                  </div>
                  <div className="editor-format-buttons">
                    <button
                      type="button"
                      className="secondary"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({
                        bold: false,
                        italic: false,
                        strikethrough: false,
                      }, { reset: true })}
                    >
                      Сброс
                    </button>
                    <button
                      type="button"
                      className={formatScope.config.bold ? "" : "secondary"}
                      aria-label={`Жирный для ${formatScope.label} блока ${formatScope.rowIndex + 1}`}
                      aria-pressed={Boolean(formatScope.config.bold)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({ bold: !formatScope.config.bold })}
                    >
                      Жирный
                    </button>
                    <button
                      type="button"
                      className={formatScope.config.italic ? "" : "secondary"}
                      aria-label={`Курсив для ${formatScope.label} блока ${formatScope.rowIndex + 1}`}
                      aria-pressed={Boolean(formatScope.config.italic)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({ italic: !formatScope.config.italic })}
                    >
                      Курсив
                    </button>
                    <button
                      type="button"
                      className={formatScope.config.strikethrough ? "" : "secondary"}
                      aria-label={`Зачеркнуть для ${formatScope.label} блока ${formatScope.rowIndex + 1}`}
                      aria-pressed={Boolean(formatScope.config.strikethrough)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({
                        strikethrough: !formatScope.config.strikethrough,
                      })}
                    >
                      Зачеркнуть
                    </button>
                  </div>
                  <div className="editor-color-palette">
                    {FILL_COLOR_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className={`editor-color-swatch${
                          formatScope.config.fill_color === value ? " active" : ""
                        }`}
                        aria-label={`${label} для ${formatScope.label} блока ${formatScope.rowIndex + 1}`}
                        aria-pressed={formatScope.config.fill_color === value}
                        style={{ backgroundColor: value }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => applyFormatting(
                          { fill_color: value },
                          { collapseSelection: true },
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="editor-table-wrap" aria-label="Таблица сценария">
        <table className="editor-table">
          <colgroup>
            {EDITOR_COLUMNS.map(({ key }) => (
              <col key={key} style={{ width: `${columnWidths[key]}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {EDITOR_COLUMNS.map(({ key, label }) => (
                <th key={key}>
                  <div className="editor-header-cell">
                    <span>{label}</span>
                    <button
                      type="button"
                      className="editor-column-resizer"
                      aria-label={`Изменить ширину столбца ${label}`}
                      onPointerDown={(event) => handleColumnResizeStart(key, event)}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <ScenarioRowComponent
                key={row.segment_uid}
                row={row}
                index={index}
                rowCount={rows.length}
                readOnly={Boolean(readOnly)}
                selected={selectedRowIds.includes(row.segment_uid)}
                focusRequest={focusRequest}
                onSelect={(multi, force) => selectRow(row.segment_uid, multi, force)}
                onRequestFocus={requestEditorFocus}
                onFormatScopeChange={setFormatScope}
                onChange={(next) => mutate((current) => current.map((item) =>
                  item.segment_uid === row.segment_uid ? next : item))}
                onDuplicate={() => {
                  const duplicate = cloneScenarioRow(row);
                  duplicate.segment_uid = createSegmentUid();
                  mutate((current) => {
                    const sourceIndex = current.findIndex(
                      (item) => item.segment_uid === row.segment_uid,
                    );
                    return sourceIndex < 0
                      ? current
                      : [
                          ...current.slice(0, sourceIndex + 1),
                          duplicate,
                          ...current.slice(sourceIndex + 1),
                        ];
                  });
                  setSelectedRowIds([duplicate.segment_uid]);
                  requestEditorFocus(
                    duplicate.segment_uid,
                    preferredFocusTarget(duplicate.block_type),
                  );
                }}
                onMove={(direction) => {
                  mutate((current) => {
                    const sourceIndex = current.findIndex(
                      (item) => item.segment_uid === row.segment_uid,
                    );
                    const target = sourceIndex + direction;
                    if (sourceIndex < 0 || target < 0 || target >= current.length) return current;
                    const next = [...current];
                    [next[sourceIndex], next[target]] = [next[target], next[sourceIndex]];
                    return next;
                  });
                  setSelectedRowIds([row.segment_uid]);
                  requestEditorFocus(
                    row.segment_uid,
                    formatScope?.segmentUid === row.segment_uid
                      ? formatScope.target
                      : preferredFocusTarget(row.block_type),
                  );
                }}
                onDelete={() => {
                  const current = rowsRef.current;
                  const sourceIndex = current.findIndex(
                    (item) => item.segment_uid === row.segment_uid,
                  );
                  const remaining = ensureEditableRows(current.filter(
                    (item) => item.segment_uid !== row.segment_uid,
                  ));
                  const nextRow = remaining[Math.min(
                    Math.max(sourceIndex, 0),
                    remaining.length - 1,
                  )];
                  mutate(() => remaining);
                  setSelectedRowIds([nextRow.segment_uid]);
                  requestEditorFocus(
                    nextRow.segment_uid,
                    preferredFocusTarget(nextRow.block_type),
                  );
                }}
              />
            ))}
          </tbody>
        </table>
      </section>
    </section>
  );
}

export { DEFAULT_EDITOR_COLUMN_WIDTHS };
