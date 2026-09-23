import { describe, expect, it } from "vitest";
import { textChangeRanges } from "./textChangeRanges";

const changed = (text: string, ranges: Array<{ start: number; end: number }>) =>
  ranges.map(({ start, end }) => text.slice(start, end));

describe("textChangeRanges", () => {
  it("marks replaced words and preserves surrounding context", () => {
    const before = "Сегодня открыт старый городской парк.";
    const after = "Сегодня открыт новый городской парк.";
    const ranges = textChangeRanges(before, after);
    expect(changed(before, ranges.before)).toEqual(["старый"]);
    expect(changed(after, ranges.after)).toEqual(["новый"]);
  });

  it("supports empty, identical, inserted and removed text", () => {
    expect(textChangeRanges("", "Новый")).toEqual({ before: [], after: [{ start: 0, end: 5 }] });
    expect(textChangeRanges("Удалён", "")).toEqual({ before: [{ start: 0, end: 6 }], after: [] });
    expect(textChangeRanges("Тот же текст", "Тот же текст")).toEqual({ before: [], after: [] });
    expect(textChangeRanges("", "")).toEqual({ before: [], after: [] });
    const after = "Начало. Новый текст. Конец.";
    const ranges = textChangeRanges("Начало. Конец.", after);
    expect(changed(after, ranges.after)).toEqual(["Новый текст. "]);
    expect(ranges.before).toEqual([]);
  });

  it("preserves Unicode punctuation, combining characters and UTF-16 offsets", () => {
    const before = "😀 «е\u0308лка» – да?";
    const after = "😀 «е\u0308лка» — да!";
    const ranges = textChangeRanges(before, after);
    expect(changed(before, ranges.before)).toEqual(["–", "?"]);
    expect(changed(after, ranges.after)).toEqual(["—", "!"]);
    expect(ranges.before.every(range => range.start > 2)).toBe(true);
  });

  it("marks whitespace and newline changes without normalization", () => {
    const before = "А  Б\nВ";
    const after = "А Б\n\nВ";
    const ranges = textChangeRanges(before, after);
    expect(changed(before, ranges.before)).toEqual(["  ", "\n"]);
    expect(changed(after, ranges.after)).toEqual([" ", "\n\n"]);
  });

  it("aligns repeated words deterministically", () => {
    const before = "да нет да потом";
    const after = "да да потом";
    const ranges = textChangeRanges(before, after);
    expect(changed(before, ranges.before)).toEqual(["нет "]);
    expect(ranges.after).toEqual([]);
    expect(textChangeRanges(before, after)).toEqual(ranges);
  });

  it("bounds work on long unrelated passages, preserving common boundaries", () => {
    const prefix = "Общее начало. ";
    const suffix = " Общий конец.";
    const before = prefix + "старое ".repeat(10000).trimEnd() + suffix;
    const after = prefix + "новое ".repeat(10000).trimEnd() + suffix;
    const ranges = textChangeRanges(before, after);
    expect(ranges.before).toEqual([{ start: prefix.length, end: before.length - suffix.length }]);
    expect(ranges.after).toEqual([{ start: prefix.length, end: after.length - suffix.length }]);
  });
});
