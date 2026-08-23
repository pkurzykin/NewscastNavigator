import {
  createDocument,
  generateHTML,
  getSchema,
  getText,
  getTextSerializersFromSchema,
  type JSONContent,
} from "@tiptap/core";
import type { Mark, Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

import { createEditorCoreExtensions } from "./extensions";
import {
  buildEditorCoreInitialContent,
  normalizeEditorCoreText,
} from "./serializers";
import type { EditorCoreRichTextTarget } from "./types";

export interface PlainTextRange {
  from: number;
  to: number;
}

interface PlainTextSegment extends PlainTextRange {
  pmFrom: number;
  pmTo: number;
  marks: readonly Mark[];
  text: string;
}

interface PlainTextMap {
  text: string;
  boundaries: number[];
  segments: PlainTextSegment[];
}

export function mapPlainTextRangeToProseMirror(
  doc: ProseMirrorNode,
  range: PlainTextRange,
  clamp = false,
): PlainTextRange | null {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to)) return null;
  const map = buildPlainTextMap(doc);
  const rawFrom = Math.trunc(range.from);
  const rawTo = Math.trunc(range.to);
  if (rawTo <= rawFrom) return null;
  const from = clamp ? Math.max(0, Math.min(rawFrom, map.text.length)) : rawFrom;
  const to = clamp ? Math.max(0, Math.min(rawTo, map.text.length)) : rawTo;
  if (from < 0 || to > map.text.length || to <= from) return null;
  const pmFrom = map.boundaries[from];
  const pmTo = map.boundaries[to];
  return pmFrom === undefined || pmTo === undefined || pmTo <= pmFrom
    ? null
    : { from: pmFrom, to: pmTo };
}

function inlineLeafText(node: ProseMirrorNode): string {
  if (node.type.name === "hardBreak") return "\n";
  const leafText = node.type.spec.leafText?.(node);
  return leafText || "\uFFFC";
}

function buildPlainTextMap(doc: ProseMirrorNode): PlainTextMap {
  let text = "";
  const boundaries: number[] = [];
  const segments: PlainTextSegment[] = [];

  const append = (
    value: string,
    pmFrom: number,
    pmTo: number,
    marks: readonly Mark[] = [],
  ) => {
    const plainFrom = text.length;
    if (boundaries[plainFrom] === undefined) boundaries[plainFrom] = pmFrom;
    text += value;
    const plainTo = text.length;

    for (let offset = 1; offset <= value.length; offset += 1) {
      boundaries[plainFrom + offset] = pmFrom + Math.min(offset, pmTo - pmFrom);
    }
    boundaries[plainTo] = pmTo;
    segments.push({ from: plainFrom, to: plainTo, pmFrom, pmTo, marks, text: value });
  };

  doc.forEach((block, blockOffset, blockIndex) => {
    const contentStart = blockOffset + 1;
    if (blockIndex > 0) {
      const previousBoundary = boundaries[text.length] ?? contentStart - 2;
      append("\n", previousBoundary, contentStart);
    } else if (boundaries[0] === undefined) {
      boundaries[0] = contentStart;
    }

    block.descendants((node, relativePosition) => {
      const position = contentStart + relativePosition;
      if (node.isText) {
        append(node.text || "", position, position + node.nodeSize, node.marks);
        return false;
      }
      if (node.isInline && node.isLeaf) {
        append(inlineLeafText(node), position, position + node.nodeSize, node.marks);
        return false;
      }
      return true;
    });

    boundaries[text.length] = contentStart + block.content.size;
  });

  if (boundaries[0] === undefined) boundaries[0] = 0;
  return { text, boundaries, segments };
}

function replacementMarks(map: PlainTextMap, offset: number): readonly Mark[] {
  return map.segments.find((segment) => (
    segment.from <= offset && offset < segment.to && segment.text !== "\n"
  ))?.marks ?? [];
}

function documentFromTarget(
  schema: Schema,
  target: EditorCoreRichTextTarget | null,
  fallbackText: string,
): ProseMirrorNode {
  return createDocument(
    buildEditorCoreInitialContent(target, fallbackText),
    schema,
    {},
    { errorOnInvalidContent: true },
  );
}

function storedText(doc: ProseMirrorNode, schema: Schema): string {
  return normalizeEditorCoreText(getText(doc, {
    blockSeparator: "\n",
    textSerializers: getTextSerializersFromSchema(schema),
  }));
}

export function editorCoreRichTextMatchesPlainText(
  target: EditorCoreRichTextTarget | null,
  fallbackText: string,
): boolean {
  if (!target) return true;
  try {
    const schema = getSchema(createEditorCoreExtensions());
    const doc = documentFromTarget(schema, target, fallbackText);
    return normalizeEditorCoreText(buildPlainTextMap(doc).text)
      === normalizeEditorCoreText(fallbackText);
  } catch {
    return false;
  }
}

export function replaceEditorCoreRichTextRanges(
  target: EditorCoreRichTextTarget | null,
  fallbackText: string,
  ranges: PlainTextRange[],
  replacement: string,
): EditorCoreRichTextTarget {
  const extensions = createEditorCoreExtensions();
  const schema = getSchema(extensions);
  const doc = documentFromTarget(schema, target, fallbackText);
  const map = buildPlainTextMap(doc);
  const descending = [...ranges].sort((left, right) => right.from - left.from || right.to - left.to);
  const transaction = EditorState.create({ schema, doc }).tr;

  for (const range of descending) {
    const pmFrom = map.boundaries[range.from];
    const pmTo = map.boundaries[range.to];
    if (pmFrom === undefined || pmTo === undefined || pmFrom > pmTo) continue;
    if (replacement) {
      transaction.replaceWith(pmFrom, pmTo, schema.text(replacement, replacementMarks(map, range.from)));
    } else {
      transaction.delete(pmFrom, pmTo);
    }
  }

  const resultDoc = transaction.doc;
  const resultJson = resultDoc.toJSON() as JSONContent;
  return {
    editor: "tiptap",
    text: storedText(resultDoc, schema),
    html: generateHTML(resultJson, extensions),
    doc: resultJson,
  };
}
