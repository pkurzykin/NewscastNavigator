import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";

import { EditorCoreField, type EditorCoreFieldChangePayload } from "../../editor-core/EditorField";
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
} from "../scenarioTableModel";
import type { ScenarioFormattingTarget, ScenarioRow as Row } from "../types";

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

function targetText(row: Row, target: FormatTargetKey): string {
  if (target === "text") return row.text;
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
  target: FormatTargetKey,
  payload: EditorCoreFieldChangePayload,
): Row {
  const next = clone(row);
  next.rich_text = {
    ...next.rich_text,
    schema_version: next.rich_text.schema_version || 1,
    targets: { ...(next.rich_text.targets || {}), [target]: payload },
  };
  if (target === "text") {
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
    next.speaker_text = [fio, position].filter(Boolean).join("\n");
  }
  return next;
}

function AutoSizeTextarea({
  value,
  disabled,
  ariaLabel,
  onFocus,
  onChange,
}: {
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onFocus: () => void;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.max(30, element.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="editor-cell-textarea editor-cell-textarea-compact"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      rows={1}
      placeholder="текст"
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default function ScenarioRow({
  row,
  index,
  rowCount,
  readOnly,
  selected,
  focusRequest,
  onChange,
  onSelect,
  onRequestFocus,
  onFormatScopeChange,
  onDuplicate,
  onMove,
  onDelete,
}: {
  row: Row;
  index: number;
  rowCount: number;
  readOnly: boolean;
  selected: boolean;
  focusRequest: { segmentUid: string; target: FormatTargetKey; nonce: number } | null;
  onChange: (row: Row) => void;
  onSelect: (multi: boolean, force?: boolean) => void;
  onRequestFocus: (segmentUid: string, target: FormatTargetKey) => void;
  onFormatScopeChange: (scope: ScenarioFormatScope) => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const rowRef = useRef(row);
  rowRef.current = row;
  const editorsRef = useRef<Partial<Record<FormatTargetKey, TiptapEditor>>>({});
  const fileNameRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFileFocusIndexRef = useRef<number | null>(null);
  const [fileBundleDraft, setFileBundleDraft] = useState("");
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

  const update = useCallback((next: Row) => {
    rowRef.current = next;
    onChange(next);
  }, [onChange]);

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
    chain.run();
    if (options?.collapseSelection) {
      activeEditor.chain().focus().setTextSelection(to).run();
    }
    activate(target, rowRef.current, false);
    return true;
  }

  const editor = (
    target: FormatTargetKey,
    placeholder: string,
    className: string,
  ) => (
    <EditorCoreField
      editorId={`${row.segment_uid}:${target}`}
      richTextTarget={row.rich_text.targets?.[target] ?? null}
      plainTextValue={targetText(row, target)}
      disabled={readOnly}
      placeholder={placeholder}
      className={className}
      ariaLabel={`${placeholder} блока ${index + 1}`}
      style={{
        fontFamily: format(row, target).font_family,
        fontWeight: format(row, target).bold ? 700 : 400,
        fontStyle: format(row, target).italic ? "italic" : "normal",
        textDecoration: format(row, target).strikethrough ? "line-through" : "none",
        backgroundColor: format(row, target).fill_color,
      }}
      focusRequest={
        focusRequest?.segmentUid === row.segment_uid && focusRequest.target === target
          ? focusRequest.nonce
          : undefined
      }
      onFocusField={() => activate(target)}
      onSelectionChange={() => activate(target, rowRef.current, false)}
      onChangeValue={(payload) => update(setRichText(rowRef.current, target, payload))}
      onRegister={(_id, instance) => {
        if (instance) editorsRef.current[target] = instance;
        else delete editorsRef.current[target];
      }}
    />
  );

  return (
    <tr
      className={selected ? "selected-row" : ""}
      onClick={(event) => onSelect(event.ctrlKey || event.metaKey)}
    >
      <td className="editor-order-cell"><span>{index + 1}</span></td>
      <td className="editor-block-type-cell">
        <div className="editor-block-cell-shell" onClick={(event) => event.stopPropagation()}>
          <select
            aria-label={`Тип блока ${index + 1}`}
            className={`editor-block-type-select editor-block-type-select-${blockTypeTone(row.block_type)}`}
            disabled={readOnly}
            value={row.block_type}
            onFocus={() => onSelect(false, true)}
            onChange={(event) => {
              const nextBlockType = event.target.value as Row["block_type"];
              update(changeScenarioRowBlockType(rowRef.current, nextBlockType));
              onRequestFocus(row.segment_uid, preferredFocusTarget(nextBlockType));
            }}
          >
            {BLOCK_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {!readOnly ? (
            <div className="editor-block-cell-actions">
              <button type="button" className="editor-row-action" aria-label="Дублировать блок" title="Дублировать блок" onClick={onDuplicate}>⧉</button>
              <button type="button" className="editor-row-action" aria-label="Поднять блок вверх" title="Поднять блок вверх" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
              <button type="button" className="editor-row-action" aria-label="Опустить блок вниз" title="Опустить блок вниз" disabled={index === rowCount - 1} onClick={() => onMove(1)}>↓</button>
              <button type="button" className="editor-row-action editor-row-action-danger" aria-label="Удалить блок" title="Удалить блок" onClick={onDelete}>×</button>
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
                        <input
                          ref={(element) => {
                            fileNameRefs.current[bundleIndex] = element;
                          }}
                          className="editor-cell-input"
                          aria-label={`Имя файла блока ${index + 1}, файл ${bundleIndex + 1}`}
                          value={buildFileBundleInputValue(bundles, bundleIndex)}
                          disabled={readOnly}
                          placeholder="Имя файла / +"
                          onFocus={() => onSelect(false, true)}
                          onChange={(event) => {
                            const resolved = resolveFileBundleInput(event.target.value, previousName);
                            update(updateFileBundle(rowRef.current, bundleIndex, {
                              file_name: resolved.fileName,
                            }));
                          }}
                        />
                      </div>
                      {!readOnly ? (
                        <button
                          type="button"
                          className="editor-file-bundle-remove"
                          aria-label={`Удалить файл ${bundleIndex + 1} блока ${index + 1}`}
                          onClick={() => update(updateRowFileBundles(
                            rowRef.current,
                            parseRowFileBundles(rowRef.current).filter((_, itemIndex) => itemIndex !== bundleIndex),
                          ))}
                        >×</button>
                      ) : null}
                    </div>
                    <div className="editor-file-bundle-row editor-file-bundle-timecodes-row">
                      <div className="editor-file-bundle-input-wrap editor-file-bundle-input-wrap-left">
                        <input
                          className={`editor-cell-input${tcInError ? " input-invalid" : ""}`}
                          aria-label={`TC IN блока ${index + 1}, файл ${bundleIndex + 1}`}
                          aria-invalid={tcInError ? "true" : "false"}
                          value={bundle.tc_in}
                          disabled={readOnly}
                          placeholder="tc in"
                          onFocus={() => {
                            onSelect(false, true);
                            setActiveTimecode(`${keyBase}:in`);
                          }}
                          onChange={(event) => update(updateFileBundle(
                            rowRef.current,
                            bundleIndex,
                            { tc_in: event.target.value },
                          ))}
                          onBlur={(event) => {
                            setActiveTimecode("");
                            update(updateFileBundle(
                              rowRef.current,
                              bundleIndex,
                              { tc_in: normalizeTimecodeDisplayValue(event.target.value) },
                            ));
                          }}
                        />
                        {tcInError ? <span className="editor-field-error">{tcInError}</span> : null}
                      </div>
                      <span className="editor-file-bundle-timecode-divider" aria-hidden="true">-</span>
                      <div className="editor-file-bundle-input-wrap editor-file-bundle-input-wrap-right">
                        <input
                          className={`editor-cell-input${tcOutError ? " input-invalid" : ""}`}
                          aria-label={`TC OUT блока ${index + 1}, файл ${bundleIndex + 1}`}
                          aria-invalid={tcOutError ? "true" : "false"}
                          value={bundle.tc_out}
                          disabled={readOnly}
                          placeholder="tc out"
                          onFocus={() => {
                            onSelect(false, true);
                            setActiveTimecode(`${keyBase}:out`);
                          }}
                          onChange={(event) => update(updateFileBundle(
                            rowRef.current,
                            bundleIndex,
                            { tc_out: event.target.value },
                          ))}
                          onBlur={(event) => {
                            setActiveTimecode("");
                            update(updateFileBundle(
                              rowRef.current,
                              bundleIndex,
                              { tc_out: normalizeTimecodeDisplayValue(event.target.value) },
                            ));
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
                  <input
                    className="editor-cell-input"
                    aria-label={`Добавить файл блока ${index + 1}`}
                    value={fileBundleDraft}
                    placeholder="Имя файла / +"
                    onFocus={() => onSelect(false, true)}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setFileBundleDraft(raw);
                      const resolved = resolveFileBundleInput(
                        raw,
                        bundles[bundles.length - 1]?.file_name || "",
                      );
                      if (!resolved.committable) return;
                      pendingFileFocusIndexRef.current = parseRowFileBundles(
                        rowRef.current,
                      ).length;
                      update(updateRowFileBundles(rowRef.current, [
                        ...parseRowFileBundles(rowRef.current),
                        { file_name: resolved.fileName, tc_in: "", tc_out: "" },
                      ]));
                      setFileBundleDraft("");
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="editor-comment-cell">
        <div className="editor-tech-shell" onClick={(event) => event.stopPropagation()}>
          <AutoSizeTextarea
            value={row.additional_comment}
            disabled={readOnly}
            ariaLabel={`В кадре ${index + 1}`}
            onFocus={() => activate("text")}
            onChange={(value) => update({ ...rowRef.current, additional_comment: value })}
          />
        </div>
      </td>
    </tr>
  );
}
