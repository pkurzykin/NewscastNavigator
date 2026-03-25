import type { JSONContent } from "@tiptap/core";

import type { ScriptElementRichTextTarget } from "../../shared/types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeEditorCoreText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\r/g, "").replace(/\n+$/g, "");
}

export function buildEditorCoreHtmlFromPlainText(value: string): string {
  const normalized = normalizeEditorCoreText(value);
  if (!normalized) {
    return "";
  }
  return escapeHtml(normalized).replace(/\n/g, "<br>");
}

export function buildEditorCoreInitialContent(
  target: ScriptElementRichTextTarget | null,
  fallbackText: string
): JSONContent | string {
  if (target?.doc && typeof target.doc === "object") {
    return target.doc as JSONContent;
  }
  if (target?.html?.trim()) {
    return target.html;
  }
  return buildEditorCoreHtmlFromPlainText(target?.text ?? fallbackText);
}

export function buildEditorCoreStoredHtml(html: string, text: string): string {
  const normalizedText = normalizeEditorCoreText(text);
  if (!normalizedText) {
    return "";
  }
  return (html || "").trim() || buildEditorCoreHtmlFromPlainText(normalizedText);
}
