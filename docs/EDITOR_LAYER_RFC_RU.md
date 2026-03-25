# RFC — Editor Layer для NewscastNavigator

Дата: 2026-03-25  
Статус: draft for implementation

## 1. Контекст

Текущий `EDITOR` уже умеет:

- структурированные строки (`СНХ`, `ЗК+гео`);
- autosave;
- базовое rich formatting;
- работу по ролям и статусам.

Но текущая реализация rich text держится на `contenteditable` и подходит только как промежуточное решение.

Проблемы текущего слоя:

- форматирование по выделению хрупкое;
- поведение курсора и выделения зависит от браузера;
- сложно надежно делать paste/undo/redo/hotkeys;
- rich content хранится слишком близко к UI-реализации;
- будущая интеграция с `CaptionPanels` и `Premiere` требует более строгой модели данных.

## 2. Цель нового editor layer

Нужен отдельный слой редактирования, который:

- работает внутри текущей табличной архитектуры;
- редактирует семантические поля строки, а не случайный HTML;
- хранит rich state отдельно от plain text;
- поддерживает устойчивое форматирование выделенного текста;
- готов к обмену данными с downstream consumers.

## 3. Что такое editor layer в этом проекте

Editor layer состоит из трех уровней:

1. `Grid layer`
- таблица строк, выбор строки, порядок, toolbar, metadata.

2. `Cell editor layer`
- курсор;
- выделение;
- inline-formatting;
- paste;
- undo/redo;
- keyboard shortcuts.

3. `Serialization layer`
- editor state -> plain text;
- editor state -> rich JSON;
- rich JSON -> editor state;
- mapping в exchange contracts.

## 4. Рекомендуемая технология

Рекомендация: `Tiptap` на базе `ProseMirror`.

Почему:

- зрелая модель rich text editing;
- удобная работа с inline marks;
- можно ограничить схему до нашего реального кейса;
- JSON документ как каноническое представление;
- не требует полной смены frontend-архитектуры.

Что не рекомендуется:

- развивать самописный `contenteditable` дальше;
- тащить тяжелый WYSIWYG “всё и сразу”;
- внедрять новый UI framework ради редактора.

## 5. Модель данных

### Канонические данные строки

Остаются отдельными:

- `block_type`
- `text`
- `speaker_text`
- `content_json`
- `file_name`
- `tc_in`
- `tc_out`
- `additional_comment`
- `segment_uid`

### Новый слой rich content

Добавляется отдельное поле:

- `rich_text_json`

В нем хранятся документы редактора по target-полям:

```json
{
  "text": { "...": "..." },
  "speaker_fio": { "...": "..." },
  "speaker_position": { "...": "..." },
  "geo": { "...": "..." }
}
```

### Текущий `formatting_json`

Его лучше сохранить как слой default formatting и UI defaults:

- font family по умолчанию;
- italic/bold defaults для пустых полей;
- fill color defaults.

То есть:

- `rich_text_json` = каноническое состояние rich editor;
- `formatting_json` = defaults/target presets;
- `text`/`speaker_text`/`content_json` = business/plain representation.

## 6. Обязательные изменения схемы БД

Перед внедрением editor layer нужно добавить:

1. `segment_uid`
2. `rich_text_json`

Причина:

- `segment_uid` нужен для cross-project синхронизации;
- `rich_text_json` нужен для устойчивого editor state.

Без этих двух полей полноценный editor layer будет временным компромиссом.

## 7. Поведение загрузки и сохранения

### Load

1. если `rich_text_json` есть:
- строим editor state из него;

2. если `rich_text_json` нет:
- синтезируем editor state из plain text полей;
- не ломаем старые записи.

### Save

При сохранении editor layer обязан отдавать:

- `plain text` для backend/export/search/validation;
- `rich_text_json` для повторного открытия editor state;
- defaults в `formatting_json`, если они менялись как свойства целого поля.

## 8. Как это связано с Story Exchange

Story Exchange не должен зависеть от HTML.

Поэтому editor layer обязан позволять:

- получить чистый plain text по каждому target;
- получить семантические поля строки;
- при необходимости отдельно экспортировать rich presentation позднее.

На первом интеграционном этапе в Story Exchange уходит только plain/semantic data.  
`rich_text_json` остается внутренним состоянием `NewscastNavigator`.

## 9. Этапы внедрения

### Этап A — foundation
- RFC и модель данных;
- миграция `segment_uid + rich_text_json`;
- backend serialization.

### Этап B — editor core
- выделенный frontend module `editor-core/`;
- Tiptap schema;
- общие serializers.

### Этап C — пилотная интеграция
- сначала только поле `text` для обычных `ЗК`;
- toolbar на editor commands;
- hotkeys.

### Этап D — structured rows
- `СНХ`: `ФИО`, `Должность`, `Текст`;
- `ЗК+гео`: `Гео`, `Текст`;
- поддержка default formatting по target.

### Этап E — cleanup
- убрать временный rich-text слой на чистом `contenteditable`;
- не держать две конкурирующие реализации дольше, чем нужно.

## 10. Предлагаемая структура frontend-модуля

```text
frontend/src/features/editor-core/
  schema.ts
  extensions.ts
  serializers.ts
  defaults.ts
  EditorField.tsx
  useEditorCell.ts
```

Принцип:
- таблица остается в `EditorPage.tsx`;
- editor-core живет как переиспользуемый подмодуль.

## 11. Что считаем Definition of Done

Полноценный editor layer считается внедренным, если:

- форматирование выделенного текста работает устойчиво;
- toolbar не зависит от `execCommand`;
- editor state переживает reload страницы;
- save/load не ломают plain text представление;
- `Story Exchange` может использовать те же канонические данные строки.

## 12. Что делаем сразу после принятия RFC

Первый технический PR должен быть не про UI, а про данные:

1. migration: `segment_uid + rich_text_json`;
2. backend models/schemas/routes;
3. тесты сериализации;
4. только затем frontend editor-core.

## 13. Текущий статус foundation

Foundation-этап на backend считается начатым, когда:

- в `script_elements` появляется `rich_text_json`;
- `GET/PUT /editor` умеют читать и сохранять `rich_text`;
- старые записи без `rich_text_json` открываются через синтез из plain text и текущего `formatting_json`.

Это еще не полноценный editor-core и не `Tiptap`, а только data contract для следующего шага.

## 14. Текущий статус frontend pilot

Первый frontend-pilot считается начатым, когда:

- в `frontend/src/features/editor-core/` появляется отдельный модуль editor-core;
- `Tiptap` подключается только для простого поля `text`;
- toolbar умеет работать через editor commands для pilot-полей;
- `СНХ` и `ЗК+гео` пока остаются на legacy-слое, чтобы не смешивать сразу structured migration и новый editor-core.

Это осознанный промежуточный этап.  
Цель пилота: проверить устойчивость `Tiptap` в текущей табличной архитектуре до перевода structured rows.

Следующий статус пилота:

- простые text-блоки уже работают через `editor-core`;
- `СНХ` переведен на `editor-core` как первый structured case;
- `ЗК+гео` тоже переведен на `editor-core`;
- legacy `contenteditable` слой остается только как временный fallback/cleanup-хвост.
