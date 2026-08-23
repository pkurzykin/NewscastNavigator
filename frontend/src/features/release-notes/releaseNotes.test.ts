import { describe, expect, it } from "vitest";

import { RELEASE_NOTES, releaseNoteStorageKey } from "./releaseNotes";

describe("release notes registry", () => {
  it("contains the approved five-item v1.2.0 note without a version fallback", () => {
    expect(RELEASE_NOTES["1.2.0"]).toEqual({
      version: "1.2.0",
      title: "Что нового в версии 1.2.0",
      intro: "Редактор стал быстрее и удобнее для ежедневной работы.",
      items: [
        "Умные русские кавычки, поиск и замена, а также общие отмена и повтор действий.",
        "Блоки сценария можно перетаскивать; кнопки перемещения и клавиатура по-прежнему доступны.",
        "В список шрифтов добавлен Franklin Gothic Book.",
        "Уведомления обновляются автоматически, а шапка стала аккуратнее на широких экранах.",
        "Исправлен ввод знака + в именах файлов.",
      ],
    });
    expect(RELEASE_NOTES["9.9.9"]).toBeUndefined();
  });

  it("builds literal per-user and per-version browser storage keys", () => {
    expect(releaseNoteStorageKey(17, "1.2.0"))
      .toBe("newscast:whats-new:17:1.2.0");
    expect(releaseNoteStorageKey(18, "1.2.0"))
      .toBe("newscast:whats-new:18:1.2.0");
    expect(releaseNoteStorageKey(17, "1.3.0"))
      .toBe("newscast:whats-new:17:1.3.0");
  });
});
