import {
  SCENARIO_PROSE_TARGETS,
  readScenarioProse,
  scenarioTextFieldKey,
  writeScenarioProse,
  type ScenarioProseTarget,
  type ScenarioTextFieldId,
} from "./scenarioTextFields";
import {
  editorCoreRichTextMatchesPlainText,
  replaceEditorCoreRichTextRanges,
} from "../editor-core/richTextOperations";
import type { ScenarioRow } from "./types";

export interface ScenarioSearchMatch extends ScenarioTextFieldId {
  from: number;
  to: number;
  ordinal: number;
  sourceText: string;
}

interface FoldedText {
  text: string;
  originalStarts: number[];
  originalEnds: number[];
}

function foldText(value: string, matchCase: boolean): FoldedText {
  if (matchCase) {
    const boundaries = Array.from({ length: value.length + 1 }, (_, index) => index);
    return { text: value, originalStarts: boundaries, originalEnds: boundaries };
  }

  let text = "";
  let originalOffset = 0;
  const originalStarts: number[] = [0];
  const originalEnds: number[] = [0];

  for (const symbol of value) {
    const originalFrom = originalOffset;
    const originalTo = originalFrom + symbol.length;
    const folded = symbol.toLocaleLowerCase("ru-RU");
    const foldedFrom = text.length;
    text += folded;

    for (let offset = 0; offset <= folded.length; offset += 1) {
      const boundary = foldedFrom + offset;
      originalStarts[boundary] = offset === folded.length ? originalTo : originalFrom;
      originalEnds[boundary] = offset === 0 ? originalFrom : originalTo;
    }
    originalOffset = originalTo;
  }

  return { text, originalStarts, originalEnds };
}

export function findScenarioMatches(
  rows: ScenarioRow[],
  query: string,
  matchCase = false,
): ScenarioSearchMatch[] {
  if (!query) return [];

  const needle = foldText(query, matchCase).text;
  if (!needle) return [];
  const matches: ScenarioSearchMatch[] = [];

  for (const row of rows) {
    for (const target of SCENARIO_PROSE_TARGETS) {
      const sourceText = readScenarioProse(row, target);
      const haystack = foldText(sourceText, matchCase);
      let foldedFrom = haystack.text.indexOf(needle);
      let previousOriginalTo = -1;
      while (foldedFrom >= 0) {
        const foldedTo = foldedFrom + needle.length;
        const from = haystack.originalStarts[foldedFrom];
        const to = haystack.originalEnds[foldedTo];
        if (from !== undefined && to !== undefined && to > from && from >= previousOriginalTo) {
          matches.push({
            segmentUid: row.segment_uid,
            target,
            from,
            to,
            ordinal: matches.length,
            sourceText,
          });
          previousOriginalTo = to;
        }
        foldedFrom = haystack.text.indexOf(needle, foldedTo);
      }
    }
  }

  return matches;
}

function isScenarioProseTarget(value: string): value is ScenarioProseTarget {
  return SCENARIO_PROSE_TARGETS.includes(value as ScenarioProseTarget);
}

function validRanges(matches: ScenarioSearchMatch[], textLength: number): boolean {
  const ranges = [...matches].sort((left, right) => left.from - right.from || left.to - right.to);
  let previousTo = -1;
  return ranges.every(({ from, to }) => {
    const valid = Number.isInteger(from)
      && Number.isInteger(to)
      && from >= 0
      && to > from
      && to <= textLength
      && from >= previousTo;
    previousTo = Math.max(previousTo, to);
    return valid;
  });
}

export function replaceScenarioMatches(
  rows: ScenarioRow[],
  matches: ScenarioSearchMatch[],
  replacement: string,
): ScenarioRow[] {
  const rowIds = new Set(rows.map((row) => row.segment_uid));
  const groups = new Map<string, ScenarioSearchMatch[]>();

  for (const match of matches) {
    if (!rowIds.has(match.segmentUid) || !isScenarioProseTarget(match.target)) continue;
    const key = scenarioTextFieldKey(match);
    const group = groups.get(key);
    if (group) group.push(match);
    else groups.set(key, [match]);
  }

  return rows.map((row) => {
    let next = row;
    for (const target of SCENARIO_PROSE_TARGETS) {
      const group = groups.get(scenarioTextFieldKey({ segmentUid: row.segment_uid, target }));
      if (!group?.length) continue;

      const plainText = readScenarioProse(next, target);
      const sourceText = group[0].sourceText;
      if (
        typeof sourceText !== "string"
        || group.some((match) => match.sourceText !== sourceText)
        || plainText !== sourceText
      ) continue;
      const richText = next.rich_text.targets?.[target] ?? null;
      const richTextIsCurrent = (!richText || richText.text === plainText)
        && editorCoreRichTextMatchesPlainText(richText, plainText);
      if (!richTextIsCurrent || !validRanges(group, plainText.length)) continue;

      const result = replaceEditorCoreRichTextRanges(
        richText,
        plainText,
        group.map(({ from, to }) => ({ from, to })),
        replacement,
      );
      if (!result) continue;
      next = writeScenarioProse(next, target, result);
    }
    return next;
  });
}
