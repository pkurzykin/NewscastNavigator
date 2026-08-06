import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { fetchScenario, saveScenario } from "../api";
import { clearScenarioDraft, readScenarioDraft } from "../draftStorage";
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
import type {
  ScenarioDraft,
  ScenarioFormattingTarget,
  ScenarioRow,
  ScenarioSnapshot,
} from "../types";
import type { RubricRef } from "../../../shared/contracts";
import { registerNavigationBlocker } from "../../../app/navigationGuard";
import { EditLeaseHandoffCoordinator, useEditLease } from "../useEditLease";
import { useScenarioAutosave } from "../useScenarioAutosave";
import AutosaveStatus from "./AutosaveStatus";
import CaptionPanelsStatus from "./CaptionPanelsStatus";
import EditLeaseNotice from "./EditLeaseNotice";
import ScenarioMetadataHeader from "./ScenarioMetadataHeader";
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
  onStoryMetadataChanged?: (patch: {
    title?: string;
    rubric?: RubricRef;
    duration_text?: string | null;
  }) => void;
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

interface ScenarioConflict {
  localDraft: ScenarioDraft;
  serverSnapshot: ScenarioSnapshot;
}

function rowPreview(row: ScenarioRow): string {
  return [
    row.text,
    row.speaker_text,
    row.file_name,
    row.tc_in,
    row.tc_out,
    row.additional_comment,
  ].filter(Boolean).join(" · ") || "Пустая строка";
}

function dialogFocusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), '
      + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden"));
}

function trapDialogFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  root: HTMLElement,
) {
  if (event.key !== "Tab") return;
  const focusable = dialogFocusableElements(root);
  if (!focusable.length) {
    event.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

export default function ScenarioEditor({
  storyId,
  userId,
  leaseCoordinator,
  onScenarioLoaded,
  onStoryMetadataChanged,
}: Props) {
  const [snapshot, setSnapshot] = useState<ScenarioSnapshot | null>(null);
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowReadModel | null>(null);
  const [workflowError, setWorkflowError] = useState("");
  const [conflict, setConflict] = useState<ScenarioConflict | null>(null);
  const [confirmServerDiscard, setConfirmServerDiscard] = useState(false);
  const [conflictRefreshError, setConflictRefreshError] = useState("");
  const [conflictRefreshing, setConflictRefreshing] = useState(false);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [formatScope, setFormatScope] = useState<ScenarioFormatScope | null>(null);
  const [focusRequest, setFocusRequest] = useState<{
    segmentUid: string;
    target: ReturnType<typeof preferredFocusTarget>;
    nonce: number;
  } | null>(null);
  const [columnWidths, setColumnWidths] = useState(loadEditorColumnWidths);
  const rowsRef = useRef<ScenarioRow[]>([]);
  const snapshotRef = useRef<ScenarioSnapshot | null>(null);
  const focusRequestNonceRef = useRef(0);
  const columnResizeCleanupRef = useRef<(() => void) | null>(null);
  const workflowRequestRef = useRef(0);
  const conflictDialogRef = useRef<HTMLElement | null>(null);
  const localConflictButtonRef = useRef<HTMLButtonElement | null>(null);
  const serverConflictButtonRef = useRef<HTMLButtonElement | null>(null);
  const conflictConfirmationRef = useRef<HTMLElement | null>(null);
  const conflictCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const conflictLayoutRef = useRef<{
    scrollY: number;
    documentHeight: number;
    activeAriaLabel: string | null;
  } | null>(null);
  const pendingConflictReturnRef = useRef<{
    scrollY: number;
    activeAriaLabel: string | null;
  } | null>(null);
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

  const captureConflictLayout = useCallback(() => {
    if (conflictLayoutRef.current) return;
    conflictLayoutRef.current = {
      scrollY: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      activeAriaLabel: document.activeElement instanceof HTMLElement
        ? document.activeElement.getAttribute("aria-label")
        : null,
    };
  }, []);

  const handleRevisionConflict = useCallback(async (localDraft: ScenarioDraft) => {
    captureConflictLayout();
    const fallback = snapshotRef.current;
    if (fallback) {
      setConflict({ localDraft, serverSnapshot: fallback });
    }
    setConfirmServerDiscard(false);
    setConflictRefreshError("");
    setConflictRefreshing(true);
    try {
      const next = await fetchScenario(storyId);
      if (currentWorkflowStoryRef.current !== storyId) return;
      snapshotRef.current = next;
      setSnapshot(next);
      const serverRows = ensureEditableRows(next.scenario.rows);
      rowsRef.current = serverRows;
      setRows(serverRows);
      setConflict({ localDraft, serverSnapshot: next });
      setConflictRefreshing(false);
      onScenarioLoaded?.(next.scenario.revision);
    } catch (requestError) {
      if (currentWorkflowStoryRef.current !== storyId) return;
      setConflictRefreshing(false);
      setConflictRefreshError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить актуальный текст с сервера.",
      );
    }
  }, [captureConflictLayout, onScenarioLoaded, storyId]);

  const autosave = useScenarioAutosave({
    storyId,
    userId,
    initialRevision: snapshot?.scenario.revision ?? 0,
    ensureLease: lease.acquire,
    save: persistScenario,
    resumeVersion: lease.resumeVersion,
    onAcknowledgedRevision: () => { void loadWorkflow(); },
    onRevisionConflict: handleRevisionConflict,
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
        if (draft && draft.revision !== next.scenario.revision) {
          conflictLayoutRef.current = null;
          autosave.enterConflict(draft.rows);
          setConflict({ localDraft: draft, serverSnapshot: next });
        } else {
          setConflict(null);
          if (draft) autosave.resumeDraft(draft);
        }
        setConfirmServerDiscard(false);
        setConflictRefreshError("");
        setConflictRefreshing(false);
        const initialRows = draft?.revision === next.scenario.revision
          ? draft.rows
          : next.scenario.rows;
        const ordered = ensureEditableRows(initialRows);
        rowsRef.current = ordered;
        setRows(ordered);
        setSelectedRowIds([]);
        setFormatScope(null);
        setFocusRequest(null);
        snapshotRef.current = next;
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

  const continueWithLocalText = useCallback(() => {
    if (!conflict || conflictRefreshing || conflictRefreshError) return;
    const nextRows = ensureEditableRows(conflict.localDraft.rows);
    rowsRef.current = nextRows;
    setRows(nextRows);
    snapshotRef.current = conflict.serverSnapshot;
    setSnapshot(conflict.serverSnapshot);
    if (conflictLayoutRef.current) {
      pendingConflictReturnRef.current = {
        scrollY: conflictLayoutRef.current.scrollY,
        activeAriaLabel: conflictLayoutRef.current.activeAriaLabel,
      };
      conflictLayoutRef.current = null;
    }
    setConflict(null);
    setConfirmServerDiscard(false);
    setConflictRefreshError("");
    autosave.rebaseConflict(nextRows, conflict.serverSnapshot.scenario.revision);
  }, [autosave, conflict, conflictRefreshError, conflictRefreshing]);

  const useServerText = useCallback(() => {
    if (!conflict || conflictRefreshing || conflictRefreshError) return;
    const nextRows = ensureEditableRows(conflict.serverSnapshot.scenario.rows);
    clearScenarioDraft(storyId, userId);
    autosave.discardConflict(conflict.serverSnapshot.scenario.revision);
    rowsRef.current = nextRows;
    setRows(nextRows);
    snapshotRef.current = conflict.serverSnapshot;
    setSnapshot(conflict.serverSnapshot);
    if (conflictLayoutRef.current) {
      pendingConflictReturnRef.current = {
        scrollY: conflictLayoutRef.current.scrollY,
        activeAriaLabel: conflictLayoutRef.current.activeAriaLabel,
      };
      conflictLayoutRef.current = null;
    }
    setConflict(null);
    setConfirmServerDiscard(false);
    setConflictRefreshError("");
  }, [
    autosave,
    conflict,
    conflictRefreshError,
    conflictRefreshing,
    storyId,
    userId,
  ]);

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

  useEffect(
    () => registerNavigationBlocker(autosave.isDirty),
    [autosave.isDirty],
  );

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

  useEffect(() => {
    if (!conflict) return;
    const frame = window.requestAnimationFrame(() => {
      const target = !conflictRefreshing && !conflictRefreshError
        ? localConflictButtonRef.current
        : conflictDialogRef.current;
      target?.focus({ preventScroll: true });
      if (conflictLayoutRef.current) {
        window.scrollTo(0, conflictLayoutRef.current.scrollY);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [Boolean(conflict), conflictRefreshError, conflictRefreshing]);

  useEffect(() => {
    if (!confirmServerDiscard) return;
    const frame = window.requestAnimationFrame(() => {
      conflictCancelButtonRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [confirmServerDiscard]);

  useEffect(() => {
    if (conflict || !pendingConflictReturnRef.current) return;
    const pending = pendingConflictReturnRef.current;
    pendingConflictReturnRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const labeledElements = [
        ...document.querySelectorAll<HTMLElement>("[aria-label]"),
      ];
      const focusTarget = (
        pending.activeAriaLabel
          ? labeledElements.find(
              (element) => element.getAttribute("aria-label") === pending.activeAriaLabel,
            )
          : null
      ) ?? document.querySelector<HTMLElement>('[aria-label="Текст блока 1"]');
      focusTarget?.focus({ preventScroll: true });
      window.scrollTo(0, pending.scrollY);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conflict, rows]);

  const closeServerDiscardConfirmation = () => {
    setConfirmServerDiscard(false);
    window.requestAnimationFrame(() => {
      serverConflictButtonRef.current?.focus({ preventScroll: true });
    });
  };

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

  const handleStoryMetadataChanged = useCallback((
    patch: {
      title?: string;
      rubric?: RubricRef;
      duration_text?: string | null;
    },
  ) => {
    setSnapshot((current) => current
      ? { ...current, story: { ...current.story, ...patch } }
      : current);
    onStoryMetadataChanged?.(patch);
  }, [onStoryMetadataChanged]);

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
  if (conflict) {
    return (
      <section
        className="scenario-editor"
        aria-label="Редактор сценария"
        style={conflictLayoutRef.current
          ? { minHeight: `${conflictLayoutRef.current.documentHeight}px` }
          : undefined}
      >
        <div className="scenario-editor-heading">
          <h2>{snapshot.story.title || "Сценарий"}</h2>
        </div>
        <section
          ref={conflictDialogRef}
          className="scenario-conflict"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="scenario-conflict-title"
          aria-describedby="scenario-conflict-description"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (confirmServerDiscard) return;
            if (event.key === "Escape") {
              event.preventDefault();
              localConflictButtonRef.current?.focus({ preventScroll: true });
              return;
            }
            if (conflictDialogRef.current) {
              trapDialogFocus(event, conflictDialogRef.current);
            }
          }}
        >
          <h3 id="scenario-conflict-title">Конфликт локального черновика</h3>
          <p id="scenario-conflict-description">
            Локальный черновик сохранён. Выберите, какой текст продолжить использовать.
          </p>
          <div className="scenario-conflict-versions">
            <section aria-label="Сохранённый локальный текст">
              <h4>Локальный текст</h4>
              <p className="small muted">
                Основан на редакции {conflict.localDraft.revision}
              </p>
              <ol
                aria-label="Строки сохранённого локального текста"
                tabIndex={0}
              >
                {conflict.localDraft.rows.map((row) => (
                  <li key={row.segment_uid}>{rowPreview(row)}</li>
                ))}
              </ol>
            </section>
            <section aria-label="Актуальный текст с сервера">
              <h4>Текст с сервера</h4>
              <p className="small muted">
                Редакция {conflict.serverSnapshot.scenario.revision}
              </p>
              <ol
                aria-label="Строки актуального текста с сервера"
                tabIndex={0}
              >
                {conflict.serverSnapshot.scenario.rows.map((row) => (
                  <li key={row.segment_uid}>{rowPreview(row)}</li>
                ))}
              </ol>
            </section>
          </div>
          <div className="scenario-conflict-actions">
            <button
              ref={localConflictButtonRef}
              type="button"
              disabled={conflictRefreshing || Boolean(conflictRefreshError)}
              onClick={continueWithLocalText}
            >
              Продолжить с локальным текстом
            </button>
            <button
              ref={serverConflictButtonRef}
              type="button"
              className="danger"
              disabled={conflictRefreshing || Boolean(conflictRefreshError)}
              onClick={() => setConfirmServerDiscard(true)}
            >
              Использовать текст с сервера
            </button>
          </div>
          {conflictRefreshing ? (
            <p className="muted" role="status">
              Обновляем актуальный текст с сервера...
            </p>
          ) : null}
          {conflictRefreshError ? (
            <p className="error" role="alert">
              Не удалось обновить серверный текст: {conflictRefreshError}{" "}
              <button
                type="button"
                onClick={() => void handleRevisionConflict(conflict.localDraft)}
              >
                Повторить загрузку
              </button>
            </p>
          ) : null}
          {confirmServerDiscard ? (
            <section
              ref={conflictConfirmationRef}
              className="scenario-conflict-confirmation"
              role="alertdialog"
              aria-modal="true"
              aria-label="Подтвердить отказ от локального текста"
              tabIndex={-1}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeServerDiscardConfirmation();
                  return;
                }
                if (conflictConfirmationRef.current) {
                  trapDialogFocus(event, conflictConfirmationRef.current);
                }
              }}
            >
              <p>
                Локальный черновик будет удалён. Это действие нельзя отменить.
              </p>
              <div className="scenario-conflict-actions">
                <button
                  ref={conflictCancelButtonRef}
                  type="button"
                  className="secondary"
                  onClick={closeServerDiscardConfirmation}
                >
                  Отменить
                </button>
                <button type="button" className="danger" onClick={useServerText}>
                  Да, использовать текст с сервера
                </button>
              </div>
            </section>
          ) : null}
        </section>
      </section>
    );
  }

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
            <div className="editor-format-toolbar" role="toolbar" aria-label="Форматирование">
                <div className="editor-format-toolbar-head">
                  <strong>Форматирование</strong>
                  <span className="small muted">
                    {formatScope
                      ? `Строка ${formatScope.rowIndex + 1}: ${formatScope.label}`
                      : "Выберите строку и поле"}
                  </span>
                </div>
                <div className="editor-format-toolbar-row editor-format-toolbar-row-inline">
                  <div className="editor-format-inline-group">
                    <span className="editor-format-inline-label">Шрифт</span>
                    <select
                      className="editor-format-font-select"
                      aria-label={formatScope
                        ? `Шрифт для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                        : "Шрифт"}
                      value={formatScope?.config.font_family || "PT Sans"}
                      disabled={!formatScope}
                      onChange={(event) => applyFormatting({ font_family: event.target.value })}
                    >
                      {FONT_OPTIONS.map((font) => <option key={font}>{font}</option>)}
                    </select>
                  </div>
                  <div className="editor-format-buttons">
                    <button
                      type="button"
                      className="secondary"
                      disabled={!formatScope}
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
                      className={formatScope?.config.bold ? "" : "secondary"}
                      aria-label={formatScope
                        ? `Жирный для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                        : "Жирный"}
                      aria-pressed={Boolean(formatScope?.config.bold)}
                      disabled={!formatScope}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({ bold: !formatScope?.config.bold })}
                    >
                      Жирный
                    </button>
                    <button
                      type="button"
                      className={formatScope?.config.italic ? "" : "secondary"}
                      aria-label={formatScope
                        ? `Курсив для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                        : "Курсив"}
                      aria-pressed={Boolean(formatScope?.config.italic)}
                      disabled={!formatScope}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({ italic: !formatScope?.config.italic })}
                    >
                      Курсив
                    </button>
                    <button
                      type="button"
                      className={formatScope?.config.strikethrough ? "" : "secondary"}
                      aria-label={formatScope
                        ? `Зачеркнуть для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                        : "Зачеркнуть"}
                      aria-pressed={Boolean(formatScope?.config.strikethrough)}
                      disabled={!formatScope}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applyFormatting({
                        strikethrough: !formatScope?.config.strikethrough,
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
                          formatScope?.config.fill_color === value ? " active" : ""
                        }`}
                        aria-label={formatScope
                          ? `${label} для ${formatScope.label} блока ${formatScope.rowIndex + 1}`
                          : label}
                        aria-pressed={formatScope?.config.fill_color === value}
                        disabled={!formatScope}
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
          </div>
        </div>
      ) : null}

      <section className="editor-script-panel" aria-label="Таблица сценария">
        {snapshot.story.rubric ? (
          <ScenarioMetadataHeader
            key={storyId}
            storyId={storyId}
            story={{ ...snapshot.story, rubric: snapshot.story.rubric }}
            editable={Boolean(snapshot.metadata?.editable) && !readOnly}
            rubrics={snapshot.metadata?.rubrics || [snapshot.story.rubric]}
            onChanged={handleStoryMetadataChanged}
          />
        ) : null}
        <div className="editor-table-wrap">
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
        </div>
      </section>
    </section>
  );
}

export { DEFAULT_EDITOR_COLUMN_WIDTHS };
