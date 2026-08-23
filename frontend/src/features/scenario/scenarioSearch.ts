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
}

function searchValue(value: string, matchCase: boolean): string {
  return matchCase ? value : value.toLocaleLowerCase("ru-RU");
}

export function findScenarioMatches(
  rows: ScenarioRow[],
  query: string,
  matchCase = false,
): ScenarioSearchMatch[] {
  if (!query) return [];

  const needle = searchValue(query, matchCase);
  const matches: ScenarioSearchMatch[] = [];

  for (const row of rows) {
    for (const target of SCENARIO_PROSE_TARGETS) {
      const haystack = searchValue(readScenarioProse(row, target), matchCase);
      let from = haystack.indexOf(needle);
      while (from >= 0) {
        matches.push({
          segmentUid: row.segment_uid,
          target,
          from,
          to: from + needle.length,
          ordinal: matches.length,
        });
        from = haystack.indexOf(needle, from + needle.length);
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
    groups.set(key, [...(groups.get(key) || []), match]);
  }

  return rows.map((row) => {
    let next = row;
    for (const target of SCENARIO_PROSE_TARGETS) {
      const group = groups.get(scenarioTextFieldKey({ segmentUid: row.segment_uid, target }));
      if (!group?.length) continue;

      const plainText = readScenarioProse(next, target);
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
      next = writeScenarioProse(next, target, result);
    }
    return next;
  });
}
