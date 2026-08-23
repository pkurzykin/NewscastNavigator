import {
  createDocument,
  generateHTML,
  getSchema,
  type JSONContent,
} from "@tiptap/core";
import type { Mark, Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

import { createEditorCoreExtensions } from "./extensions";
import { buildEditorCoreInitialContent } from "./serializers";
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
  const map = buildPlainTextMap(doc);
  return mapRange(map, range, clamp);
}

function mapRange(
  map: PlainTextMap,
  range: PlainTextRange,
  clamp: boolean,
): PlainTextRange | null {
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to)) return null;
  const rawFrom = range.from;
  const rawTo = range.to;
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

export function mapPlainTextRangesToProseMirror(
  doc: ProseMirrorNode,
  ranges: PlainTextRange[],
  clamp = false,
): Array<PlainTextRange | null> {
  const map = buildPlainTextMap(doc);
  return ranges.map((range) => mapRange(map, range, clamp));
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

function storedText(doc: ProseMirrorNode): string {
  return buildPlainTextMap(doc).text;
}

export function editorCoreRichTextMatchesPlainText(
  target: EditorCoreRichTextTarget | null,
  fallbackText: string,
): boolean {
  try {
    const schema = getSchema(createEditorCoreExtensions());
    const doc = documentFromTarget(schema, target, fallbackText);
    return buildPlainTextMap(doc).text === fallbackText;
  } catch {
    return false;
  }
}

export function replaceEditorCoreRichTextRanges(
  target: EditorCoreRichTextTarget | null,
  fallbackText: string,
  ranges: PlainTextRange[],
  replacement: string,
): EditorCoreRichTextTarget | null {
  const extensions = createEditorCoreExtensions();
  const schema = getSchema(extensions);
  const doc = documentFromTarget(schema, target, fallbackText);
  const map = buildPlainTextMap(doc);
  if (
    (target && target.text !== fallbackText)
    || map.text !== fallbackText
    || !ranges.length
  ) return null;
  const descending = [...ranges].sort((left, right) => right.from - left.from || right.to - left.to);
  let previousFrom = map.text.length;
  for (const range of descending) {
    if (
      !Number.isInteger(range.from)
      || !Number.isInteger(range.to)
      || range.from < 0
      || range.to <= range.from
      || range.to > map.text.length
      || range.to > previousFrom
      || map.boundaries[range.from] === undefined
      || map.boundaries[range.to] === undefined
      || map.boundaries[range.from] >= map.boundaries[range.to]
    ) return null;
    previousFrom = range.from;
  }
  const transaction = EditorState.create({ schema, doc }).tr;

  for (const range of descending) {
    const pmFrom = map.boundaries[range.from];
    const pmTo = map.boundaries[range.to];
    if (replacement) {
      transaction.replaceWith(pmFrom!, pmTo!, schema.text(replacement, replacementMarks(map, range.from)));
    } else {
      transaction.delete(pmFrom!, pmTo!);
    }
  }

  const resultDoc = transaction.doc;
  const resultJson = resultDoc.toJSON() as JSONContent;
  return {
    editor: "tiptap",
    text: storedText(resultDoc),
    html: generateHTML(resultJson, extensions),
    doc: resultJson,
  };
}
