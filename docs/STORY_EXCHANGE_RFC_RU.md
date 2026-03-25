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
- не зависит от server-to-server интеграции;
- может жить как versioned JSON-артефакт;
- сохраняет семантику сюжета, а не только плоский текст.

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

## 9. Почему не прямой API между проектами

Прямой API-coupling сейчас нецелесообразен:

- `CaptionPanels` живет как Windows-first plugin с offline/runtime constraints;
- его текущая архитектура уже построена на файловых JSON-контрактах;
- будущий `Premiere` plugin, скорее всего, тоже лучше строить как consumer артефактов, а не как постоянный online client.

Поэтому transport на первом этапе:

- export JSON из `NewscastNavigator`;
- import/adapt внутри downstream tools.

## 10. Что не входит в v1

В первую версию не входят:

- прямой двусторонний sync по API;
- live-edit между `NewscastNavigator` и AE;
- хранение AE/Premiere-specific служебных полей в канонической модели;
- замена внутреннего backend API `NewscastNavigator`.

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
