import { AccessInput, AccessSelect } from "../AccessNativeField";
import { useFieldEditAccess } from "../ScenarioAccessContext";
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import { EditorCoreField, type EditorCoreFieldChangePayload } from "../../editor-core/EditorField";
import { editorFontCssStack } from "../../editor-core/fontRegistry";
import { isFileBundlePlusKey, replaceInputSelection } from "../fileBundleInput";
import {
  BLOCK_OPTIONS,
  buildFileBundleInputValue,
  blockTypeTone,
  changeScenarioRowBlockType,
  parseRowFileBundles,
  resolveFileBundleInput,
  timecodeValidationMessage,
  normalizeTimecodeDisplayValue,
  preferredFocusTarget,
  scenarioFormatting,
  updateFileBundle,
  updateRowFileBundles,
  type FormatTargetKey,
  type ScenarioTextTargetKey,
} from "../scenarioTableModel";
import type { ScenarioFormattingTarget, ScenarioRow as Row } from "../types";
import type { ScenarioMutationMeta } from "../scenarioHistory";
import {
  scenarioTextFieldKey,
  type ScenarioTextFieldController,
} from "../scenarioTextFields";

export interface ScenarioFormatScope {
  segmentUid: string;
  rowIndex: number;
  target: FormatTargetKey;
  label: string;
  config: ScenarioFormattingTarget;
  applySelection: (
    patch: Partial<ScenarioFormattingTarget>,
    options?: { reset?: boolean; collapseSelection?: boolean },
  ) => boolean;
}

function clone(row: Row): Row {
  return structuredClone(row);
}

function targetText(row: Row, target: ScenarioTextTargetKey): string {
  if (target === "text") return row.text;
  if (target === "additional_comment") return row.additional_comment;
  if (target === "geo") {
    return typeof row.structured_data.geo === "string" ? row.structured_data.geo : "";
  }
  const [fio = "", position = ""] = row.speaker_text.split("\n");
  return target === "speaker_fio" ? fio : position;
}

function format(row: Row, target: FormatTargetKey): ScenarioFormattingTarget {
  return scenarioFormatting(row, target);
}

function setRichText(
  row: Row,
  target: ScenarioTextTargetKey,
  payload: EditorCoreFieldChangePayload,
): Row {
  const next = clone(row);
  next.rich_text = {
    ...next.rich_text,
    schema_version: next.rich_text.schema_version || 1,
    targets: { ...(next.rich_text.targets || {}), [target]: payload },
  };
  if (target === "additional_comment") {
    next.additional_comment = payload.text;
  } else if (target === "text") {
    next.text = payload.text;
    if (next.block_type === "zk_geo") {
      next.structured_data = {
        ...next.structured_data,
        text_lines: payload.text
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean),
      };
    }
  } else if (target === "geo") {
    next.structured_data = { ...next.structured_data, geo: payload.text };
  } else {
    const fio = target === "speaker_fio" ? payload.text : targetText(row, "speaker_fio");
    const position = target === "speaker_position"
      ? payload.text
      : targetText(row, "speaker_position");
    next.speaker_text = position ? `${fio}\n${position}` : fio;
  }
  return next;
}

export default function ScenarioRow({
  row,
  index,
  rowCount,
  readOnly,
  selected,
  focusRequest,
  onChange,
  onEditorRegister,
  onHistoryFocusBoundary,
  onSelect,
  onRequestFocus,
  onFormatScopeChange,
  onDuplicate,
  onMove,
  onDelete,
  dragging,
  structuralActionsDisabled,
  dropEdge,
  onDragPointerDown,
}: {
  row: Row;
  index: number;
  rowCount: number;
  readOnly: boolean;
  selected: boolean;
  focusRequest: { segmentUid: string; target: FormatTargetKey; nonce: number } | null;
  onChange: (row: Row, meta: ScenarioMutationMeta) => boolean | void;
  onEditorRegister: (
    editorId: string,
    editor: TiptapEditor | null,
    controller: ScenarioTextFieldController | null,
  ) => void;
  onHistoryFocusBoundary: () => void;
  onSelect: (multi: boolean, force?: boolean) => void;
  onRequestFocus: (segmentUid: string, target: FormatTargetKey) => void;
  onFormatScopeChange: (scope: ScenarioFormatScope) => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  dragging?: boolean;
  structuralActionsDisabled?: boolean;
  dropEdge?: "before" | "after" | null;
  onDragPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const access = useFieldEditAccess();
  const accessRef = useRef(access); accessRef.current = access;
  const rowRef = useRef(row);
  rowRef.current = row;
  const editorsRef = useRef<Partial<Record<FormatTargetKey, TiptapEditor>>>({});
  const fileNameRefs = useRef<Array<HTMLInputElement | null>>([]);
  const fileBundleDraftRef = useRef<HTMLInputElement | null>(null);
  const pendingFileFocusIndexRef = useRef<number | null>(null);
  const pendingFileCaretRef = useRef<
    | { target: "bundle"; bundleIndex: number; caret: number }
    | { target: "draft"; caret: number }
    | null
  >(null);
  const pendingFormattingRef = useRef(false);
  const [fileBundleDraft, setFileBundleDraft] = useState("");
  const [fileBundleCaretRequest, setFileBundleCaretRequest] = useState(0);
  const [activeTimecode, setActiveTimecode] = useState("");
  const bundles = parseRowFileBundles(row);

  useLayoutEffect(() => {
    const pendingIndex = pendingFileFocusIndexRef.current;
    if (pendingIndex === null || bundles.length <= pendingIndex) return;
    const input = fileNameRefs.current[pendingIndex];
    input?.focus();
    if (input) {
      const caret = input.value.length;
      input.setSelectionRange(caret, caret);
    }
    pendingFileFocusIndexRef.current = null;
  }, [bundles.length]);

  useLayoutEffect(() => {
    const pending = pendingFileCaretRef.current;
    if (!pending) return;
    const input = pending.target === "draft"
      ? fileBundleDraftRef.current
      : fileNameRefs.current[pending.bundleIndex];
    if (!input) return;
    const frame = requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(pending.caret, pending.caret);
      pendingFileCaretRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [bundles, fileBundleCaretRequest, fileBundleDraft, row]);

  const update = useCallback((next: Row, meta: ScenarioMutationMeta) => {
    if (accessRef.current && !accessRef.current.canMutate()) return;
    if (onChange(next, meta) !== false) rowRef.current = next;
  }, [onChange]);

  const fieldMeta = useCallback((property: string): ScenarioMutationMeta => ({
    kind: "typing",
    groupKey: `field:${row.segment_uid}:${property}`,
  }), [row.segment_uid]);

  const fileFieldMeta = useCallback((
    bundleIndex: number,
    property: "file_name" | "tc_in" | "tc_out",
  ): ScenarioMutationMeta => ({
    kind: "field",
    groupKey: `field:${row.segment_uid}:file:${bundleIndex}:${property}`,
  }), [row.segment_uid]);

  const activate = useCallback((
    target: FormatTargetKey,
    source = rowRef.current,
    selectRow = true,
  ) => {
    const label = target === "geo"
      ? "гео"
      : target === "speaker_fio"
        ? "ФИО"
        : target === "speaker_position"
          ? "должности"
          : "текста";
    if (selectRow) onSelect(false, true);
    onFormatScopeChange({
      segmentUid: source.segment_uid,
      rowIndex: index,
      target,
      label,
      config: format(source, target),
      applySelection: (patch, options) => applySelectionFormat(target, patch, options),
    });
  }, [index, onFormatScopeChange, onSelect]);

  function applySelectionFormat(
    target: FormatTargetKey,
    patch: Partial<ScenarioFormattingTarget>,
    options?: { reset?: boolean; collapseSelection?: boolean },
  ): boolean {
    if (accessRef.current && !accessRef.current.canMutate()) return false;
    const activeEditor = editorsRef.current[target];
    if (!activeEditor) return false;
    const { from, to } = activeEditor.state.selection;
    if (from === to) return false;
    const chain = activeEditor.chain().focus();
    if (options?.reset) {
      chain
        .unsetMark("bold")
        .unsetMark("italic")
        .unsetMark("strike")
        .unsetHighlight()
        .unsetFontFamily();
    } else {
      if (patch.font_family !== undefined) chain.setFontFamily(patch.font_family);
      if (patch.bold !== undefined) {
        patch.bold ? chain.setMark("bold") : chain.unsetMark("bold");
      }
      if (patch.italic !== undefined) {
        patch.italic ? chain.setMark("italic") : chain.unsetMark("italic");
      }
      if (patch.strikethrough !== undefined) {
        patch.strikethrough ? chain.setMark("strike") : chain.unsetMark("strike");
      }
      if (patch.fill_color !== undefined) chain.setHighlight({ color: patch.fill_color });
    }
    pendingFormattingRef.current = true;
    try {
      chain.run();
    } finally {
      pendingFormattingRef.current = false;
    }
    if (options?.collapseSelection) {
      activeEditor.chain().focus().setTextSelection(to).run();
    }
    activate(target, rowRef.current, false);
    return true;
  }

  function applyFileBundleDraft(rawValue: string): void {
    setFileBundleDraft(rawValue);
    const resolved = resolveFileBundleInput(
      rawValue,
      bundles[bundles.length - 1]?.file_name || "",
    );
    if (!resolved.committable) return;
    pendingFileFocusIndexRef.current = parseRowFileBundles(rowRef.current).length;
    update(updateRowFileBundles(rowRef.current, [
      ...parseRowFileBundles(rowRef.current),
      { file_name: resolved.fileName, tc_in: "", tc_out: "" },
    ]), { kind: "structure" });
    setFileBundleDraft("");
  }

  const editor = (
    target: ScenarioTextTargetKey,
    placeholder: string,
    className: string,
    ariaLabel = `${placeholder} блока ${index + 1}`,
  ) => (
    <EditorCoreField
      editorId={scenarioTextFieldKey({ segmentUid: row.segment_uid, target })}
      richTextTarget={row.rich_text.targets?.[target] ?? null}
      plainTextValue={targetText(row, target)}
      disabled={readOnly}
      placeholder={placeholder}
      className={className}
      ariaLabel={ariaLabel}
      style={target === "additional_comment" ? undefined : {
        fontFamily: editorFontCssStack(format(row, target).font_family),
        fontWeight: format(row, target).bold ? 700 : 400,
        fontStyle: format(row, target).italic ? "italic" : "normal",
        textDecoration: format(row, target).strikethrough ? "line-through" : "none",
        backgroundColor: format(row, target).fill_color,
      }}
      focusRequest={
        target !== "additional_comment"
          && focusRequest?.segmentUid === row.segment_uid && focusRequest.target === target
          ? focusRequest.nonce
          : undefined
      }
      onFocusField={() => {
        onHistoryFocusBoundary();
        if (target === "additional_comment") onSelect(false, true);
        else activate(target);
      }}
      onSelectionChange={() => {
        if (target !== "additional_comment") activate(target, rowRef.current, false);
      }}
      onChangeValue={(payload) => update(
        setRichText(rowRef.current, target, payload),
        pendingFormattingRef.current ? { kind: "formatting" } : fieldMeta(target),
      )}
      onRegister={(_id, instance, controller) => {
        if (target !== "additional_comment") {
          if (instance) editorsRef.current[target] = instance;
          else delete editorsRef.current[target];
        }
        onEditorRegister(_id, instance, controller);
      }}
    />
  );

  return (
    <tr
      data-segment-uid={row.segment_uid}
      className={[
        selected ? "selected-row" : "",
        dragging ? "scenario-row-dragging" : "",
        dropEdge ? `scenario-row-drop-${dropEdge}` : "",
      ].filter(Boolean).join(" ")}
      onClick={(event) => onSelect(event.ctrlKey || event.metaKey)}
    >
      <td className="editor-order-cell"><span>{index + 1}</span></td>
      <td className="editor-block-type-cell">
        <div className="editor-block-cell-shell" onClick={(event) => event.stopPropagation()}>
          <AccessSelect
            aria-label={`Тип блока ${index + 1}`}
            className={`editor-block-type-select editor-block-type-select-${blockTypeTone(row.block_type)}`}
            disabled={readOnly || structuralActionsDisabled}
            value={row.block_type}
            onFocus={() => onSelect(false, true)}
            onChange={(event) => {
              const nextBlockType = event.target.value as Row["block_type"];
              update(changeScenarioRowBlockType(rowRef.current, nextBlockType), { kind: "structure" });
              onRequestFocus(row.segment_uid, preferredFocusTarget(nextBlockType));
            }}
          >
            {BLOCK_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </AccessSelect>
          {!readOnly ? (
            <div className="editor-block-cell-actions">
              <button
                type="button"
                className="editor-row-action editor-row-drag-handle"
                aria-label={`Перетащить блок ${index + 1}`}
                aria-disabled={Boolean(structuralActionsDisabled && !dragging)}
                aria-grabbed={Boolean(dragging)}
                title={`Перетащить блок ${index + 1}`}
                onPointerDown={onDragPointerDown}
              >↕</button>
              <button type="button" className="editor-row-action" aria-label="Дублировать блок" title="Дублировать блок" disabled={structuralActionsDisabled} onClick={onDuplicate}>⧉</button>
              <button type="button" className="editor-row-action" aria-label="Поднять блок вверх" title="Поднять блок вверх" disabled={structuralActionsDisabled || index === 0} onClick={() => onMove(-1)}>↑</button>
              <button type="button" className="editor-row-action" aria-label="Опустить блок вниз" title="Опустить блок вниз" disabled={structuralActionsDisabled || index === rowCount - 1} onClick={() => onMove(1)}>↓</button>
              <button type="button" className="editor-row-action editor-row-action-danger" aria-label="Удалить блок" title="Удалить блок" disabled={structuralActionsDisabled} onClick={onDelete}>×</button>
            </div>
          ) : null}
        </div>
      </td>
      <td className={`editor-text-cell${row.block_type === "snh" || row.block_type === "zk_geo" ? " editor-text-cell-structured" : ""}`}>
        <div className="editor-block-shell" onClick={(event) => event.stopPropagation()}>
          <div className="editor-text-flow">
            {row.block_type === "zk_geo" ? (
              <div className="structured-editor">
                {editor("geo", "Гео", "structured-editor-line rich-text-field-compact")}
                {editor("text", "Текст", "structured-editor-text")}
              </div>
            ) : row.block_type === "snh" ? (
              <div className="structured-editor">
                {editor("speaker_fio", "ФИО", "structured-editor-line structured-editor-line-emphasis rich-text-field-compact")}
                {editor("speaker_position", "Должность", "structured-editor-line structured-editor-line-emphasis rich-text-field-compact")}
                {editor("text", "Текст СНХ", "structured-editor-text")}
              </div>
            ) : editor("text", "Текст", "editor-cell-textarea")}
          </div>
        </div>
      </td>
      <td className="editor-file-cell">
        <div className="editor-tech-shell" onClick={(event) => event.stopPropagation()}>
          <div className="editor-file-stack">
            {bundles.map((bundle, bundleIndex) => {
              const keyBase = `${row.segment_uid}:${bundleIndex}`;
              const tcInError = activeTimecode === `${keyBase}:in`
                ? ""
                : timecodeValidationMessage(bundle.tc_in);
              const tcOutError = activeTimecode === `${keyBase}:out`
                ? ""
                : timecodeValidationMessage(bundle.tc_out);
              const previousName = bundles[bundleIndex - 1]?.file_name || "";
              return (
                <div className="editor-file-bundle" key={keyBase}>
                  <div className="editor-file-bundle-fields">
                    <div className="editor-file-bundle-row editor-file-bundle-primary-row">
                      <div className="editor-file-bundle-input-wrap">
                        <AccessInput
                          ref={(element) => {
                            fileNameRefs.current[bundleIndex] = element;
                          }}
                          className="editor-cell-input"
                          aria-label={`Имя файла блока ${index + 1}, файл ${bundleIndex + 1}`}
                          value={buildFileBundleInputValue(bundles, bundleIndex)}
                          disabled={readOnly}
                          placeholder="Имя файла / +"
                          onFocus={() => {
                            onHistoryFocusBoundary();
                            onSelect(false, true);
                          }}
                          onKeyDown={(event) => {
                            if (!isFileBundlePlusKey(event.nativeEvent)) return;
                            event.preventDefault();
                            const next = replaceInputSelection(
                              event.currentTarget.value,
                              event.currentTarget.selectionStart,
                              event.currentTarget.selectionEnd,
                              "+",
                            );
                            pendingFileCaretRef.current = {
                              target: "bundle",
                              bundleIndex,
                              caret: next.caret,
                            };
                            setFileBundleCaretRequest((request) => request + 1);
                            const resolved = resolveFileBundleInput(next.value, previousName);
                            update(updateFileBundle(rowRef.current, bundleIndex, {
                              file_name: resolved.fileName,
                            }), fileFieldMeta(bundleIndex, "file_name"));
                          }}
                          onChange={(event) => {
                            const resolved = resolveFileBundleInput(event.target.value, previousName);
                            update(updateFileBundle(rowRef.current, bundleIndex, {
                              file_name: resolved.fileName,
                            }), fileFieldMeta(bundleIndex, "file_name"));
                          }}
                        />
                      </div>
                      {!readOnly ? (
                        <button
                          type="button"
                          className="editor-file-bundle-remove"
                          aria-label={`Удалить файл ${bundleIndex + 1} блока ${index + 1}`}
                          disabled={structuralActionsDisabled}
                          onClick={() => update(
                            updateRowFileBundles(
                              rowRef.current,
                              parseRowFileBundles(rowRef.current).filter((_, itemIndex) => itemIndex !== bundleIndex),
                            ),
                            { kind: "structure" },
                          )}
                        >×</button>
                      ) : null}
                    </div>
                    <div className="editor-file-bundle-row editor-file-bundle-timecodes-row">
                      <div className="editor-file-bundle-input-wrap editor-file-bundle-input-wrap-left">
                        <AccessInput
                          className={`editor-cell-input${tcInError ? " input-invalid" : ""}`}
                          aria-label={`TC IN блока ${index + 1}, файл ${bundleIndex + 1}`}
                          aria-invalid={tcInError ? "true" : "false"}
                          value={bundle.tc_in}
                          disabled={readOnly}
                          placeholder="tc in"
                          onFocus={() => {
                            onHistoryFocusBoundary();
                            onSelect(false, true);
                            setActiveTimecode(`${keyBase}:in`);
                          }}
                          onChange={(event) => update(
                            updateFileBundle(rowRef.current, bundleIndex, { tc_in: event.target.value }),
                            fileFieldMeta(bundleIndex, "tc_in"),
                          )}
                          onBlur={(event) => {
                            setActiveTimecode("");
                            update(
                              updateFileBundle(rowRef.current, bundleIndex, {
                                tc_in: normalizeTimecodeDisplayValue(event.target.value),
                              }),
                              fileFieldMeta(bundleIndex, "tc_in"),
                            );
                          }}
                        />
                        {tcInError ? <span className="editor-field-error">{tcInError}</span> : null}
                      </div>
                      <span className="editor-file-bundle-timecode-divider" aria-hidden="true">-</span>
                      <div className="editor-file-bundle-input-wrap editor-file-bundle-input-wrap-right">
                        <AccessInput
                          className={`editor-cell-input${tcOutError ? " input-invalid" : ""}`}
                          aria-label={`TC OUT блока ${index + 1}, файл ${bundleIndex + 1}`}
                          aria-invalid={tcOutError ? "true" : "false"}
                          value={bundle.tc_out}
                          disabled={readOnly}
                          placeholder="tc out"
                          onFocus={() => {
                            onHistoryFocusBoundary();
                            onSelect(false, true);
                            setActiveTimecode(`${keyBase}:out`);
                          }}
                          onChange={(event) => update(
                            updateFileBundle(rowRef.current, bundleIndex, { tc_out: event.target.value }),
                            fileFieldMeta(bundleIndex, "tc_out"),
                          )}
                          onBlur={(event) => {
                            setActiveTimecode("");
                            update(
                              updateFileBundle(rowRef.current, bundleIndex, {
                                tc_out: normalizeTimecodeDisplayValue(event.target.value),
                              }),
                              fileFieldMeta(bundleIndex, "tc_out"),
                            );
                          }}
                        />
                        {tcOutError ? <span className="editor-field-error">{tcOutError}</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {!readOnly ? (
              <div className="editor-file-bundle editor-file-bundle-draft">
                <div className="editor-file-bundle-row editor-file-bundle-draft-row">
                  <AccessInput
                    ref={fileBundleDraftRef}
                    className="editor-cell-input"
                    aria-label={`Добавить файл блока ${index + 1}`}
                    value={fileBundleDraft}
                    disabled={structuralActionsDisabled}
                    placeholder="Имя файла / +"
                    onFocus={() => {
                      onHistoryFocusBoundary();
                      onSelect(false, true);
                    }}
                    onKeyDown={(event) => {
                      if (!isFileBundlePlusKey(event.nativeEvent)) return;
                      event.preventDefault();
                      const next = replaceInputSelection(
                        event.currentTarget.value,
                        event.currentTarget.selectionStart,
                        event.currentTarget.selectionEnd,
                        "+",
                      );
                      pendingFileCaretRef.current = { target: "draft", caret: next.caret };
                      setFileBundleCaretRequest((request) => request + 1);
                      applyFileBundleDraft(next.value);
                    }}
                    onChange={(event) => applyFileBundleDraft(event.target.value)}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="editor-comment-cell">
        <div className="editor-tech-shell" onClick={(event) => event.stopPropagation()}>
          {editor(
            "additional_comment",
            "текст",
            "editor-cell-textarea editor-cell-textarea-compact",
            `В кадре ${index + 1}`,
          )}
        </div>
      </td>
    </tr>
  );
}
