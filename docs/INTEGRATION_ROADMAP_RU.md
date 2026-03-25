# Дорожная карта интеграции: NewscastNavigator + CaptionPanels + future Premiere

Дата: 2026-03-25  
Статус: working roadmap

## 1. Общая цель

Построить экосистему из трех уровней:

- `NewscastNavigator` — редакторская master-система;
- `CaptionPanels` — downstream-инструмент для AE-титров, субтитров и auto-timing;
- будущий `Premiere` plugin — downstream-инструмент для авто-нарезки и таймингов.

Ключевой принцип:

`NewscastNavigator` хранит канонические story data, а downstream tools получают versioned exchange artifacts.

## 2. Роли репозиториев

### `NewscastNavigator`
- web-only продукт;
- master по проекту и строкам сценария;
- владелец exchange contract;
- владелец `segment_uid`.

### `CaptionPanels`
- Windows-first AE plugin;
- consumer обменного формата через adapter;
- источник runtime-результатов типа `blocks.json`, `alignment.json`, run manifests.

### будущий plugin для `Premiere`
- отдельный consumer того же story exchange;
- владелец собственного cut/timing adapter target.

## 3. Что обязательно сделать в NewscastNavigator первым

### PR 1 — документы и архитектурная фиксация
- `STORY_EXCHANGE_RFC_RU.md`
- `EDITOR_LAYER_RFC_RU.md`
- эта дорожная карта

Статус: делается этим пакетом документации.

### PR 2 — стабильные идентификаторы
- добавить `segment_uid` в `script_elements`;
- обеспечить сохранение `segment_uid` при обычном редактировании;
- покрыть тестами create/clone/save scenarios.

### PR 3 — Story Exchange export foundation
- добавить backend serializer `Story Exchange v1`;
- добавить export service / endpoint;
- покрыть mapping tests по block types.

Статус: реализовано этим шагом.

### PR 4 — CaptionPanels adapter
- на стороне `NewscastNavigator` или отдельного adapter-модуля получить JSON в формате, который понимает `CaptionPanels`;
- не менять старые server flows и не добавлять tight coupling.

Статус: реализовано этим шагом как backend export adapter поверх `Story Exchange v1`.

### PR 5 — editor layer foundation
- миграция `rich_text_json`;
- подготовка editor-core;
- переход от временного `contenteditable` к устойчивому editor state.

## 4. Что делать в CaptionPanels

Из этого репозитория мы сейчас не меняем `CaptionPanels`, но для следующего этапа там должны появиться зеркальные документы и задачи.

Минимум для `CaptionPanels`:

1. зафиксировать, что `NewscastNavigator` становится upstream source;
2. описать adapter boundary:
   - что приходит из Story Exchange;
   - что остается в текущем import JSON;
3. не ломать текущий `Import JSON` flow до подтвержденного adapter-перехода.

Рекомендуемый документ в `CaptionPanels`:

- `docs/INTEGRATION_WITH_NEWSCAST_RU.md`

## 5. Что делать для будущего Premiere plugin

Не начинать plugin сразу с прямой интеграции к backend.

Правильный путь:

1. использовать тот же `segment_uid`;
2. опереться на `Story Exchange v1`;
3. отдельно описать `Cut Exchange` или `Timing Exchange`, когда будет понятен фактический workflow нарезки.

На текущем этапе для `Premiere` достаточно:

- не ломать будущую совместимость;
- сохранять в Story Exchange file/tc данные и порядок сегментов.

## 6. Минимальный mapping Newscast -> CaptionPanels

Базовая договоренность:

- `podvodka`, `zk` -> `voiceover`
- `snh`, `life` -> `synch`
- `zk_geo` -> `geotag + voiceover`

Дополнительно:

- `title` -> `meta.title`
- `rubric` -> `meta.rubric`
- `СНХ ФИО/Должность` -> `speakers[]`
- `segment_uid` -> downstream `id`

## 7. Что пока не делаем

Пока не делаем:

- live sync с `CaptionPanels`;
- прямое чтение Postgres из плагинов;
- общий monorepo;
- shared runtime между web и AE plugin;
- sync назад из AE в web без отдельного feedback RFC.

## 8. После какой точки можно снова активно пилить Editor UX

После двух технических основ:

1. `segment_uid`
2. `Story Exchange v1`

Только после этого UI-эволюция `EDITOR` будет устойчивой и не приведет к переделке данных второй раз.

## 9. Suggested implementation order

1. `docs/*` RFC пакет
2. `segment_uid` migration
3. `Story Exchange` serializer + endpoint
4. adapter `Story -> CaptionPanels Import`
5. `rich_text_json` migration
6. полноценный editor-core
7. отдельный mirrored doc/task set в `CaptionPanels`

## 10. Критерий готовности к cross-project разработке

Можно считать, что проекты синхронизированы на архитектурном уровне, если:

- в `NewscastNavigator` есть `segment_uid`;
- есть описанный и versioned `Story Exchange v1`;
- есть документированный mapping в `CaptionPanels`;
- `EDITOR` развивается уже с учетом этих контрактов, а не как isolated UI.
