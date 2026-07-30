# Product Reset — UX/UI evaluation

Статус: локальная оценка Commit 7.2. Она подтверждает UX hard gate, но не закрывает
Checkpoint 7, operations rehearsal или внешний demo gate.

## Итог

| Категория | Балл | Обоснование |
|---|---:|---|
| Общая иерархия | 9 | Раздел, сюжет и активная вкладка считываются сразу на обоих размерах экрана. |
| Фокус на списке | 10 | Даже с личной очередью общий список начинается в верхней части экрана, на 1366 одновременно видны более шести строк. |
| Следующее действие | 9 | В рабочем контексте отмечен ровно один главный action; дополнительные действия визуально вторичны. |
| Плотность | 9 | 30 синтетических сюжетов образуют рабочую таблицу без карточной стены и горизонтальной прокрутки. |
| Простота | 9 | Сохранены только согласованные фильтры, шесть колонок и три вкладки карточки. |
| Дизайн-код | 9 | Сохраняется Editorial Air: бумажные поверхности, графит, синий action и коралловый высокий приоритет. |
| Согласованность | 9 | Таблица, вкладки, production sections и действия используют один визуальный язык. |
| Обратная связь | 8 | Ошибки и ожидание имеют понятные сообщения; обычные операции остаются ненавязчивыми. |
| Типографика и доступность | 9 | Onest, видимый focus, keyboard dialog flow и axe без critical/serious нарушений проверены автоматически. |
| Общее качество | 9 | Основные экраны выглядят целостным desktop-продуктом и проходят измеримые browser gates. |

Итого: **90/100**. Минимум категории: **8/10**.

## Обнаруженные недостатки и визуальная итерация

- До hard gate личная очередь не имела измеримого ограничения высоты. В итерации
  уменьшены внутренние интервалы, а browser test закрепил максимум и видимость
  шести строк на `1366×768`.
- У главного действия не было общего машинного маркера, а ref специализированной
  кнопки первоначально не возвращал focus после закрытия dialog. Общий
  `ActionButton` теперь сохраняет ref и выставляет marker только логическому primary.
- Accessibility evidence существовала только как pass/fail в логе. Теперь четыре
  пользовательские поверхности сохраняют отдельные axe JSON с viewport и violations.

Before-снимки сделаны на принятом `df5378e552496ceb50fa5c423b26ba7bdf54ada7`
до изменений 7.2. After-снимки созданы тем же Chromium на тех же viewport после
GREEN hard gate. Сравнение показывает, что более тяжёлый набор из 30 сюжетов и
трёх личных действий сохраняет список главным объектом, а карточка производства
оставляет завершённые этапы в компактном закрытом summary.

## Артефакты

- [Before: список 1366](../../artifacts/product-reset/CP7/ux/before/stories-chromium-1366.png)
- [Before: список 1920](../../artifacts/product-reset/CP7/ux/before/stories-chromium-1920.png)
- [Before: производство 1366](../../artifacts/product-reset/CP7/ux/before/production-chromium-1366.png)
- [Before: производство 1920](../../artifacts/product-reset/CP7/ux/before/production-chromium-1920.png)
- [After: список 1366](../../artifacts/product-reset/CP7/ux/after/stories-chromium-1366.png)
- [After: список 1920](../../artifacts/product-reset/CP7/ux/after/stories-chromium-1920.png)
- [After: производство 1366](../../artifacts/product-reset/CP7/ux/after/production-chromium-1366.png)
- [After: производство 1920](../../artifacts/product-reset/CP7/ux/after/production-chromium-1920.png)
- Axe JSON: `stories`, `production`, `notifications`, `dialog` на `1366×768`.

<!-- UX_EVAL_MACHINE_READABLE_BEGIN -->
```json
{
  "schema_version": 1,
  "ux_total": 90,
  "categories": {
    "overall_hierarchy": {
      "label": "Общая иерархия",
      "score": 9,
      "rationale": "Раздел, сюжет и активная вкладка считываются сразу на обоих согласованных размерах экрана.",
      "screens": [
        "after-stories-chromium-1366",
        "after-production-chromium-1920"
      ]
    },
    "list_focus": {
      "label": "Фокус на списке",
      "score": 10,
      "rationale": "Общий список остаётся главным объектом: на 1366 с личной очередью одновременно видны более шести строк.",
      "screens": [
        "after-stories-chromium-1366",
        "after-stories-chromium-1920"
      ]
    },
    "next_action": {
      "label": "Следующее действие",
      "score": 9,
      "rationale": "В карточке виден один главный action, а дополнительные действия остаются визуально вторичными.",
      "screens": [
        "after-production-chromium-1366"
      ]
    },
    "density": {
      "label": "Плотность",
      "score": 9,
      "rationale": "Тридцать сюжетов и три личных действия помещаются в плотную рабочую таблицу без горизонтальной прокрутки.",
      "screens": [
        "after-stories-chromium-1366"
      ]
    },
    "simplicity": {
      "label": "Простота",
      "score": 9,
      "rationale": "Сохранены только согласованные фильтры, шесть колонок, три вкладки и компактное summary завершённых этапов.",
      "screens": [
        "after-stories-chromium-1366",
        "after-production-chromium-1366"
      ]
    },
    "design_code": {
      "label": "Дизайн-код",
      "score": 9,
      "rationale": "Editorial Air узнаваем по бумажным поверхностям, графиту, синему action и коралловому высокому приоритету.",
      "screens": [
        "after-stories-chromium-1920"
      ]
    },
    "consistency": {
      "label": "Согласованность",
      "score": 9,
      "rationale": "Список, вкладки, production sections и действия используют одинаковые отступы, линии и состояния.",
      "screens": [
        "after-stories-chromium-1366",
        "after-production-chromium-1366"
      ]
    },
    "feedback": {
      "label": "Обратная связь",
      "score": 8,
      "rationale": "Ошибки и ожидание имеют рабочие сообщения, а обычные успешные операции не создают визуального шума.",
      "screens": [
        "after-production-chromium-1366"
      ]
    },
    "typography_accessibility": {
      "label": "Типографика и доступность",
      "score": 9,
      "rationale": "Onest, keyboard focus, dialog trap/restore и отсутствие critical/serious axe violations подтверждены browser tests.",
      "screens": [
        "after-stories-chromium-1366",
        "after-production-chromium-1366"
      ]
    },
    "overall_quality": {
      "label": "Общее качество",
      "score": 9,
      "rationale": "Ключевые desktop-экраны выглядят целостным рабочим продуктом на 1366 и 1920.",
      "screens": [
        "after-stories-chromium-1920",
        "after-production-chromium-1920"
      ]
    }
  },
  "artifacts": [
    {
      "id": "before-stories-chromium-1366",
      "kind": "screenshot",
      "phase": "before",
      "viewport": "1366x768",
      "surface": "stories",
      "path": "artifacts/product-reset/CP7/ux/before/stories-chromium-1366.png",
      "sha256": "6e1c9e613d27f80fbdc5fb0c79caaf9161e0ede5fc6a6c6a15561dfdc9b0de43"
    },
    {
      "id": "before-stories-chromium-1920",
      "kind": "screenshot",
      "phase": "before",
      "viewport": "1920x1080",
      "surface": "stories",
      "path": "artifacts/product-reset/CP7/ux/before/stories-chromium-1920.png",
      "sha256": "c260beb174d3b8dda3cd2718b701f6e74833fcf58133345c093139ba7412c9ad"
    },
    {
      "id": "before-production-chromium-1366",
      "kind": "screenshot",
      "phase": "before",
      "viewport": "1366x768",
      "surface": "production",
      "path": "artifacts/product-reset/CP7/ux/before/production-chromium-1366.png",
      "sha256": "d5212a664e7b828cfdadae7732583b5f4a8f0230f6639f4f36b54a0ffb257a3e"
    },
    {
      "id": "before-production-chromium-1920",
      "kind": "screenshot",
      "phase": "before",
      "viewport": "1920x1080",
      "surface": "production",
      "path": "artifacts/product-reset/CP7/ux/before/production-chromium-1920.png",
      "sha256": "226c3c499979c2badd8fef5cfd8f4ed7751da90be7ce13921209efe7ea3256f6"
    },
    {
      "id": "after-stories-chromium-1366",
      "kind": "screenshot",
      "phase": "after",
      "viewport": "1366x768",
      "surface": "stories",
      "path": "artifacts/product-reset/CP7/ux/after/stories-chromium-1366.png",
      "sha256": "99786edb4935da6c420089b09b0b63a2a58f743f560b2b52278e6c03f42d30fc"
    },
    {
      "id": "after-stories-chromium-1920",
      "kind": "screenshot",
      "phase": "after",
      "viewport": "1920x1080",
      "surface": "stories",
      "path": "artifacts/product-reset/CP7/ux/after/stories-chromium-1920.png",
      "sha256": "68f3515ed447b07a56e88c1d714e5b864787f787046114546be86cd0ef016a72"
    },
    {
      "id": "after-production-chromium-1366",
      "kind": "screenshot",
      "phase": "after",
      "viewport": "1366x768",
      "surface": "production",
      "path": "artifacts/product-reset/CP7/ux/after/production-chromium-1366.png",
      "sha256": "08bd6ed68161aee0efa83444c8e99eae1ddd8e7c63e949a8afb986079bfd342d"
    },
    {
      "id": "after-production-chromium-1920",
      "kind": "screenshot",
      "phase": "after",
      "viewport": "1920x1080",
      "surface": "production",
      "path": "artifacts/product-reset/CP7/ux/after/production-chromium-1920.png",
      "sha256": "80071916de33c6886c04ce95efbc76a94d6228b056718baf1226dd1115d71954"
    },
    {
      "id": "axe-stories-chromium-1366",
      "kind": "axe_json",
      "phase": "axe",
      "viewport": "1366x768",
      "surface": "stories",
      "path": "artifacts/product-reset/CP7/ux/axe/axe-stories-chromium-1366.json",
      "sha256": "62f8d5df711bfe8f5c93486723b307fe89b59d7327fc34743ee87a7b8bc38071"
    },
    {
      "id": "axe-production-chromium-1366",
      "kind": "axe_json",
      "phase": "axe",
      "viewport": "1366x768",
      "surface": "production",
      "path": "artifacts/product-reset/CP7/ux/axe/axe-production-chromium-1366.json",
      "sha256": "de97c2273701cd5bb3843f808a3086bf1ce451ffb93017b0cddb69ae89acca3e"
    },
    {
      "id": "axe-notifications-chromium-1366",
      "kind": "axe_json",
      "phase": "axe",
      "viewport": "1366x768",
      "surface": "notifications",
      "path": "artifacts/product-reset/CP7/ux/axe/axe-notifications-chromium-1366.json",
      "sha256": "62f8d5df711bfe8f5c93486723b307fe89b59d7327fc34743ee87a7b8bc38071"
    },
    {
      "id": "axe-dialog-chromium-1366",
      "kind": "axe_json",
      "phase": "axe",
      "viewport": "1366x768",
      "surface": "dialog",
      "path": "artifacts/product-reset/CP7/ux/axe/axe-dialog-chromium-1366.json",
      "sha256": "62f8d5df711bfe8f5c93486723b307fe89b59d7327fc34743ee87a7b8bc38071"
    }
  ],
  "defects": [
    {
      "id": "UX-01",
      "status": "fixed",
      "description": "Личная очередь не имела измеримого desktop hard gate по высоте и видимости общего списка.",
      "before_artifact": "before-stories-chromium-1366",
      "after_artifact": "after-stories-chromium-1366"
    },
    {
      "id": "UX-02",
      "status": "fixed",
      "description": "Главное действие не имело единого marker contract для browser verification.",
      "before_artifact": "before-production-chromium-1366",
      "after_artifact": "after-production-chromium-1366"
    },
    {
      "id": "UX-03",
      "status": "remaining_minor",
      "description": "Длинная production-карточка по-прежнему требует вертикальной прокрутки при большом количестве материалов и назначений.",
      "before_artifact": "before-production-chromium-1920",
      "after_artifact": "after-production-chromium-1920"
    }
  ],
  "visual_iteration": {
    "before_summary": "Принятый Editorial Air уже имел ясную иерархию, но не имел отдельного измеримого UX hard gate и связанного artifact manifest.",
    "changes": [
      "Добавлен exact desktop browser gate для общего списка, Attention, шести колонок, трёх tabs, URL refresh, primary action и completed stages.",
      "Уплотнена личная очередь без потери читаемости.",
      "Общий ActionButton получил primary marker и сохранил ref для возврата keyboard focus.",
      "Axe evidence расширена на production-карточку и сохраняется отдельными JSON artifacts."
    ],
    "after_summary": "На 1366 и 1920 общий список остаётся главным объектом без horizontal overflow; карточка показывает один следующий шаг и компактные завершённые этапы."
  },
  "comparison": {
    "summary": "После итерации более тяжёлый синтетический набор из 30 сюжетов и трёх личных действий проходит desktop density gate, а production-карточка сохраняет ясный единственный action.",
    "before_artifacts": [
      "before-stories-chromium-1366",
      "before-stories-chromium-1920",
      "before-production-chromium-1366",
      "before-production-chromium-1920"
    ],
    "after_artifacts": [
      "after-stories-chromium-1366",
      "after-stories-chromium-1920",
      "after-production-chromium-1366",
      "after-production-chromium-1920"
    ]
  }
}
```
<!-- UX_EVAL_MACHINE_READABLE_END -->
