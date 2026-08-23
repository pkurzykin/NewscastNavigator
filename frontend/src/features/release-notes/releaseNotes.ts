export interface ReleaseNote {
  version: string;
  title: string;
  intro: string;
  items: string[];
}

export const RELEASE_NOTES: Readonly<Record<string, ReleaseNote>> = {
  "1.2.0": {
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
  },
};

export function releaseNoteStorageKey(userId: number, version: string): string {
  return `newscast:whats-new:${userId}:${version}`;
}
