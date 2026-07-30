# CaptionPanels integration contract

## Инвариант

CaptionPanels при каждом открытии получает актуальный сценарий напрямую с
сервера. Пользователь не выбирает revision. Если текст изменился после уже
выполненной загрузки в After Effects, NewscastNavigator уведомляет дизайнера и
показывает diff; автоматического фонового обновления After Effects нет.

## API

Authenticated endpoints:

```text
GET /api/v1/integrations/captionpanels/stories
GET /api/v1/integrations/captionpanels/stories/{story_id}/import-json
```

Список содержит доступные сюжеты. Import document строится из текущего
`Scenario`, фиксирует exact opened revision marker и сохраняет stable story/row
identifiers. Source of truth остаётся сценарий NewscastNavigator.

## Mapping

Сохраняются пользовательские типы блоков табличного редактора и действующие
CaptionPanels integration fields. Каждая строка экспортируется в исходном
порядке; `story_id` и row/segment UID стабильны между сохранениями. Пустые
необязательные поля не превращаются в новые сущности.

CEP fetch может приходить с origin `null`. Разрешение задаётся только явным
`ALLOW_NULL_CORS_ORIGIN=true`; wildcard CORS не используется.

## Проверка

```bash
cd backend
pytest -q \
  tests/test_captionpanels_current_scenario.py \
  tests/test_scenario_autosave.py
```

Проверяются latest scenario, stable mapping, opened revision marker и late-edit
notification. Внешний visual smoke CaptionPanels выполняется только после
отдельного разрешения на demo boundary.

Один сюжет — один актуальный сценарий.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
