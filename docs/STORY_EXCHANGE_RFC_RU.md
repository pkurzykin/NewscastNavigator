# RFC — Story Exchange v1

Дата: 2026-03-25  
Статус: draft for implementation

## 1. Зачем нужен Story Exchange

`NewscastNavigator` больше не должен думать только про собственный web-экран.  
Он становится source of truth для сценария, который затем потребляют:

- `CaptionPanels` для титров, субтитров и auto-timing в After Effects;
- будущий plugin для `Premiere Pro` для авто-нарезки по таймингам;
- внутренние export-механизмы (`DOCX`, `PDF`, служебные JSON).

Нужен единый переносимый формат обмена, который:

- не привязан к UI конкретного проекта;
- не привязан к внутренней схеме backend/API;
- может жить как versioned JSON-артефакт;
- сохраняет семантику сюжета, а не только плоский текст.

Важно:

- `Story Exchange` не является основным пользовательским UX для `CaptionPanels`;
- для пользователя это foundation/fallback-слой;
- целевой пользовательский сценарий для `CaptionPanels` — выбрать проект в плагине и по одной кнопке получить downstream-представление этого проекта.

## 2. Роли систем

### `NewscastNavigator`
- источник истины по проекту, строкам и редакторской структуре;
- хранит семантические поля сценария;
- экспортирует versioned exchange-артефакты.

### `CaptionPanels`
- downstream consumer;
- не становится master-системой для сценария;
- получает адаптированный JSON и строит титры/субтитры/тайминги в AE.

### будущий `Premiere` plugin
- отдельный downstream consumer;
- использует тот же источник данных, но со своим adapter target;
- опирается на те же стабильные идентификаторы сегментов.

## 3. Основные принципы

1. Канонический формат обмена находится на стороне `NewscastNavigator`.
2. Интеграция между проектами идет через versioned JSON contracts, а не через tight coupling API.
3. Каждый сегмент должен иметь стабильный внешний идентификатор, не зависящий от порядка строки.
4. Семантика хранится отдельно от rich text оформления.
5. Любой downstream adapter должен быть воспроизводимым и testable.

## 4. Обязательные идентификаторы

До начала интеграции в `NewscastNavigator` должны появиться:

- `story_uid` или эквивалентный внешний id проекта;
- `segment_uid` для каждой строки сценария.

Требования к `segment_uid`:

- генерируется один раз при создании строки;
- не зависит от `order_index`;
- сохраняется при редактировании строки;
- используется в exchange JSON, адаптерах и будущем feedback loop.

Без этого невозможно корректно связывать:

- subtitle blocks и alignment из `CaptionPanels`;
- будущие cut/timing результаты из `Premiere`.

## 5. Каноническая модель Story Exchange v1

`Story Exchange v1` это JSON-артефакт уровня сюжета.

Минимальная структура:

```json
{
  "schemaVersion": 1,
  "storyUid": "story_...",
  "generatedAt": "2026-03-25T12:00:00Z",
  "source": {
    "system": "newscastnavigator",
    "version": "0.2.x"
  },
  "project": {
    "id": 42,
    "title": "Заголовок сюжета",
    "rubric": "Новости",
    "plannedDuration": "02:30",
    "status": "draft"
  },
  "speakers": [
    {
      "speakerId": "speaker_...",
      "name": "Фамилия Имя",
      "job": "Должность"
    }
  ],
  "segments": [
    {
      "segmentUid": "seg_...",
      "order": 1,
      "blockType": "zk_geo",
      "semanticType": "voiceover",
      "text": "Текст закадра",
      "textLines": ["Текст закадра"],
      "geo": "Москва",
      "speakerId": null,
      "file": {
        "name": "master_01.mov",
        "tcIn": "00:01",
        "tcOut": "00:10"
      },
      "notes": {
        "onScreen": "текст"
      }
    }
  ]
}
```

## 6. Поля Story Exchange v1

### `project`
- редакторские метаданные проекта;
- не содержат server-specific конфигурацию или пути.

### `speakers`
- канонический список спикеров, используемых downstream adapters;
- на первом этапе может собираться из уникальных `СНХ`-строк;
- позже может быть заменен на полноценный registry проекта.

### `segments`
Каждый сегмент обязан содержать:

- `segmentUid`
- `order`
- `blockType`
- `semanticType`
- `text`
- `textLines`
- `file.name`
- `file.tcIn`
- `file.tcOut`
- `notes.onScreen`

Опциональные поля:

- `geo`
- `speakerId`
- future timing data
- future editorial flags

## 7. Mapping из Newscast block types

Базовое соответствие:

- `podvodka` -> `semanticType = "voiceover"`
- `zk` -> `semanticType = "voiceover"`
- `zk_geo` -> `semanticType = "voiceover"` + отдельное поле `geo`
- `snh` -> `semanticType = "sync"` + `speakerId`
- `life` -> `semanticType = "sync"` без обязательного `speakerId`

Важно:
- `blockType` сохраняем как исходную newsroom-семантику;
- `semanticType` вводим как нормализованное поле для downstream consumers.

## 8. Adapter для CaptionPanels

`CaptionPanels` пока работает со своим import contract:
- [import.schema.json](/Volumes/work/Projects/CaptionPanels/docs/schemas/import.schema.json)

Поэтому первый этап интеграции выглядит так:

`NewscastNavigator Story Exchange -> CaptionPanels Import JSON`

Базовый mapping:

- `voiceover` -> `segment.type = "voiceover"`
- `sync`/`life` -> `segment.type = "synch"`
- `speakerId` из Story Exchange -> `speakerId` в import JSON
- `project.title` -> `meta.title`
- `project.rubric` -> `meta.rubric`
- `zk_geo.geo` -> отдельный `geotag` segment, который adapter ставит непосредственно перед соответствующим `voiceover`

Техническое правило для первого адаптера:

- `segmentUid` из Story Exchange должен попадать в `id` downstream segment;
- adapter не меняет редакторский смысл строки;
- все преобразования должны быть обратимо объяснимыми.

Операционный UX для следующего этапа:

1. пользователь в `CaptionPanels` выбирает проект/сценарий из `NewscastNavigator`;
2. плагин получает downstream `CaptionPanels Import JSON` именно для выбранного проекта;
3. плагин использует существующий import path для создания субтитров;
4. ручной export/import JSON остается как fallback и диагностический путь.

## 9. Почему не прямой доступ к внутренним данным NewscastNavigator

Плохой путь:

- прямое чтение таблиц Postgres из плагина;
- завязка `CaptionPanels` на внутренние backend-модели `NewscastNavigator`;
- импорт “сырых” editor-данных без versioned adapter слоя.

Правильный путь:

- `CaptionPanels` может работать online с `NewscastNavigator`;
- но он должен получать не внутренние данные, а versioned adapter-представление;
- transport может быть и файловым, и HTTP, но контракт должен оставаться тем же самым downstream JSON.

То есть на следующем этапе допустим online-fetch из плагина, но не tight coupling к внутренней схеме `NewscastNavigator`.

## 10. Что не входит в v1

В первую версию не входят:

- прямой двусторонний sync по API;
- live-edit между `NewscastNavigator` и AE;
- хранение AE/Premiere-specific служебных полей в канонической модели;
- замена внутреннего backend API `NewscastNavigator`.

При этом в v1 уже допускается следующий transport-сценарий:

- `CaptionPanels` по сети запрашивает adapter-экспорт для выбранного проекта;
- но получает все равно versioned JSON-контракт, а не внутреннюю server-модель.

## 11. Минимальные изменения в NewscastNavigator перед реализацией

Обязательный минимум:

1. добавить `segment_uid` в `script_elements`;
2. ввести server-side export модели `Story Exchange v1`;
3. покрыть mapping unit/smoke tests;
4. не смешивать exchange contract с текущими `DOCX/PDF` экспортами.

## 12. Следующий этап

После принятия этого RFC следующий рабочий порядок такой:

1. `segment_uid` migration и backend serialization;
2. `Story Exchange v1` export endpoint/service;
3. adapter в формат `CaptionPanels Import JSON`;
4. только после этого — более глубокая переработка `EDITOR` под полноценный editor layer.

## 13. Текущая backend-реализация

На текущем этапе `Story Exchange v1` отдается отдельным backend export endpoint:

- `GET /api/v1/projects/{project_id}/export/story-exchange`

Технические оговорки первой реализации:

- `storyUid` пока строится как детерминированный внешний id `story_{project.id}`;
- `segmentUid` берется из стабильного `script_elements.segment_uid`;
- `DOCX/PDF` exports не меняются и продолжают жить отдельно от exchange contract.

## 14. Первый adapter для CaptionPanels

Поверх `Story Exchange v1` backend также отдает отдельный adapter export:

- `GET /api/v1/projects/{project_id}/export/captionpanels-import`

Текущий mapping:

- `voiceover` сегменты -> `type = "voiceover"`
- `snh` и `life` -> `type = "synch"`
- `zk_geo` -> две записи:
  - `geotag` с текстом `geo`
  - затем `voiceover` с текстом самого ЗК

Технические оговорки первой реализации:

- `CaptionPanels` получает свой привычный import JSON и не зависит от прямого server API;
- `id` downstream-сегмента равен `segmentUid`, а для `geotag` используется суффикс `:geo`;
- adapter не заменяет `Story Exchange`, а строится поверх него как consumer-specific target.
