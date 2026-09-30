---
type: reference
status: active
owner: development
audience: developers, agents
reviewed: 2026-09-30
---

# Текущая архитектура NewscastNavigator

## Назначение и правило данных

NewscastNavigator — desktop-only приложение телередакции. Главный инвариант:

> Один сюжет — один актуальный сценарий — одна понятная цепочка работы.

PostgreSQL является единственной рабочей базой. Production содержит рабочие
данные: изменения схемы выполняются миграциями с оценкой совместимости,
backup и возможного восстановления. Изменение актуального сценария не создаёт
пользовательскую ветку или отдельную рабочую копию.

## Компоненты

```text
Chromium
  -> React/Vite frontend
  -> /api/v1 FastAPI
  -> services and server-side action policy
  -> SQLAlchemy
  -> PostgreSQL 16

CaptionPanels
  -> /api/v1/integrations/captionpanels
  -> latest current scenario mapper
```

Frontend разделён по `stories`, `scenario`, `workflow`, `production`,
`corrections`, `notifications`, `history`, `captionpanels` и `admin`. Backend
выражает изменения конкретными commands, а не произвольным полем статуса.

## Навигация и read models

- `/stories` — активные сюжеты и компактный блок «Требует внимания»;
- `/stories/:id/scenario` — редактор, проверка, корректура, CaptionPanels;
- `/stories/:id/production` — назначения и производственные этапы;
- `/stories/:id/history` — meaningful events, edit sessions, diff, restore;
- `/archive` — архив;
- `/admin` — пользователи и справочники.

Story list и story card используют server-computed current situation, actions и
permissions. Недоступные действия не должны появляться в UI, но backend всё
равно проверяет каждую команду.

## Сценарий и autosave

Stable row IDs создаются до первого save. Открытый editor остаётся
local-authoritative: server save возвращает только ack/revision metadata,
устаревший ответ не заменяет новый локальный ввод. Сохранения single-flight,
idempotent и lease-aware. Technical revisions не показываются как ручные версии;
пользовательская история группируется по edit sessions.

## Workflow и производство

Editorial review и proofread — отметки над одним актуальным текстом. Поздняя
правка сама не снимает proofread. Производство содержит assignments, material
links, voiceover, video, titles, repeatable external approval cycles, aired и
archive. Correction package — единая структура правок с items по областям.

## Runtime paths

- local: `compose.yaml`;
- test PostgreSQL: `compose.test.yaml`;
- постоянный домашний тестовый сервер: `deploy/home-test/compose.yaml`;
- production на Hostland: `deploy/hostland/production.compose.yaml`;
- demo: `deploy/compose.demo.yaml`.

Назначение и границы сред — в [эксплуатации](../operations/README_RU.md).
API CaptionPanels описывает [интеграционный контракт](CAPTIONPANELS_CONTRACT_RU.md),
порядок изменения и проверки системы — [инженерные правила](DEVELOPMENT_RU.md).

Backend images устанавливают `requirements.lock` с `--require-hashes`. CI
устанавливает `requirements-dev.lock`. Frontend всегда устанавливается через
`npm ci`.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
