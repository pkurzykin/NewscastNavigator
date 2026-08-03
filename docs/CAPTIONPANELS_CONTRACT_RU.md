# CaptionPanels integration contract

## Инвариант

CaptionPanels при каждом открытии получает актуальный сценарий напрямую с
сервера. Пользователь не выбирает revision. Если текст изменился после уже
выполненной загрузки в After Effects, NewscastNavigator уведомляет дизайнера и
показывает diff; автоматического фонового обновления After Effects нет.

## API

Authenticated endpoints:

```text
POST /api/v1/auth/login                    Origin: null
GET  /api/v1/auth/me                       Origin: null + CaptionPanels bearer
GET  /api/v1/integrations/captionpanels/projects
GET  /api/v1/integrations/captionpanels/projects/{project_id}/import-json
GET /api/v1/integrations/captionpanels/stories
GET /api/v1/integrations/captionpanels/stories/{story_id}/import-json
```

Установленный CEP-клиент использует стабильные `/projects` endpoints и поле
`projectId`; `/stories` остаётся эквивалентным серверным alias. Оба маршрута
читают одну и ту же модель сюжета и не создают отдельной версии или копии
сценария. Список содержит доступные сюжеты. Import document строится из текущего
`Scenario`, фиксирует exact opened revision marker и сохраняет stable story/row
identifiers. Source of truth остаётся сценарий NewscastNavigator.

Обычный browser login возвращает только HttpOnly session cookie. Только запрос
входа с точным `Origin: null` дополнительно получает отдельный восьмичасовой
`access_token` с назначением `captionpanels`. Этот bearer принимается только
`GET /api/v1/auth/me` и CaptionPanels integration endpoints при том же точном
origin. Он связан с серверной `UserSession`, проверяет active user и отзыв
сессии, не принимается общим story/admin API и не обходит обязательную смену
временного пароля. Сам `Origin: null` не считается способом аутентификации.

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
  tests/test_auth.py \
  tests/characterization/test_captionpanels_contract.py \
  tests/test_captionpanels_current_scenario.py \
  tests/test_scenario_autosave.py
```

Проверяются точный handshake установленного клиента, token scope/revocation,
latest scenario, stable mapping, opened revision marker и late-edit
notification. Внешний visual smoke CaptionPanels выполняется только после
отдельного разрешения на demo boundary.

Один сюжет — один актуальный сценарий.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
