import { describe, expect, it } from "vitest";

import { resolveRussianQuoteEdit } from "./russianQuotes";

describe("resolveRussianQuoteEdit", () => {
  it.each([
    ["начало документа", "", "", "", { insert: "«»", caretOffset: 1 }],
    ["начало строки", "Первая строка\n", "", "дальше", { insert: "«»", caretOffset: 1 }],
    ["пробел слева", "Сказал ", "", "текст", { insert: "«»", caretOffset: 1 }],
    ["круглая скобка слева", "Сказал (", "", "текст", { insert: "«»", caretOffset: 1 }],
    ["квадратная скобка слева", "Сказал [", "", "текст", { insert: "«»", caretOffset: 1 }],
    ["фигурная скобка слева", "Сказал {", "", "текст", { insert: "«»", caretOffset: 1 }],
    ["среднее тире слева", "Сказал –", "", "текст", { insert: "«»", caretOffset: 1 }],
    ["длинное тире слева", "Сказал —", "", "текст", { insert: "«»", caretOffset: 1 }],
    ["двоеточие слева", "Сказал:", "", "текст", { insert: "«»", caretOffset: 1 }],
    ["точка слева", "Фраза.", "", "Текст", { insert: "«»", caretOffset: 1 }],
  ])("inserts an opening pair at %s", (_label, before, selected, after, expected) => {
    expect(resolveRussianQuoteEdit(before, selected, after)).toEqual(expected);
  });

  it.each([
    ["после буквы", "Текст", "", " далее", { insert: "»", caretOffset: 1 }],
    ["после цифры", "Версия 2", "", " далее", { insert: "»", caretOffset: 1 }],
    ["после круглой закрывающей скобки", "Текст)", "", " далее", { insert: "»", caretOffset: 1 }],
    ["после квадратной закрывающей скобки", "Текст]", "", " далее", { insert: "»", caretOffset: 1 }],
    ["после фигурной закрывающей скобки", "Текст}", "", " далее", { insert: "»", caretOffset: 1 }],
  ])("inserts a closing quote %s", (_label, before, selected, after, expected) => {
    expect(resolveRussianQuoteEdit(before, selected, after)).toEqual(expected);
  });

  it("wraps the exact selection and puts the caret after it", () => {
    expect(resolveRussianQuoteEdit("Сказал ", "текст", " далее")).toEqual({
      insert: "«текст»",
      caretOffset: 7,
    });
  });

  it("moves over an existing closing quote without duplicating it", () => {
    expect(resolveRussianQuoteEdit("«текст", "", "» далее")).toEqual({
      insert: "",
      caretOffset: 1,
    });
  });

  it("uses only the current line to resolve multiline context", () => {
    expect(resolveRussianQuoteEdit("Закрытый контекст\n", "", "Новая строка")).toEqual({
      insert: "«»",
      caretOffset: 1,
    });
    expect(resolveRussianQuoteEdit("Открытая строка\nслово", "", " далее")).toEqual({
      insert: "»",
      caretOffset: 1,
    });
  });
});
