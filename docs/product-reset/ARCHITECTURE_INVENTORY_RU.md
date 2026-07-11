# NewscastNavigator Product Reset — ранний architecture inventory

Решения относятся к исходному состоянию на `IMPLEMENTATION_BASE_SHA=a540e47704b26afc02272e6c05e311f48b894f85`. Это первый проход; финальная фактическая сверка выполняется в CP7.

| Область | Текущее состояние | Решение | Целевое состояние / checkpoint |
|---|---|---|---|
| React/Vite frontend | Web UI, крупный `EditorPage`, legacy project/workflow screens | ADAPT | React desktop-only routes `/stories`, story tabs, `/archive`, `/admin` |
| FastAPI backend | Route/service API вокруг Project и status tracks | ADAPT | Конкретные domain commands и server-side gates |
| PostgreSQL + SQLAlchemy + Alembic | PostgreSQL production path, SQLite в части тестов, 23 legacy migrations | KEEP + REPLACE | PostgreSQL как единственная рабочая БД, одна baseline migration в CP2 |
| Docker/Compose | Root production compose и несколько дублирующих deploy paths | ADAPT | Один local path, один demo path, отдельный `compose.test.yaml` |
| Авторизация | Signed session/auth cookie, bcrypt compatibility | ADAPT | PBKDF2-only contract и function-based permissions в CP2 |
| Пользователи и роли | Одна legacy role/model | REPLACE | position + объединяемые functions + per-story assignments |
| Сюжеты | Монолитный `Project` | REPLACE | `stories`, rubrics, assignments, materials, events |
| Редактор сценария | Табличный редактор, пять block types, rich text, reorder/duplicate/delete | KEEP через characterization, затем ADAPT | Один актуальный сценарий; local-authoritative autosave |
| Состояние сценария | workspace/current/checked/proofread copies и manual revisions | REPLACE | ack-only technical revisions + edit-session history |
| CaptionPanels | Рабочий import JSON поверх выбранной legacy revision | ADAPT | Всегда latest current scenario, без ручного `text_seq` |
| Workflow | Универсальные статусы и отдельные track copies | REPLACE | Review/proofread marks, production commands и correction packages |
| Notifications/comments | Comment actions и частично status-driven context | REPLACE | Сгруппированные персональные notifications; общей ленты нет |
| Files/exports | Upload/storage, DOCX/PDF/export paths | DELETE | Только внешние material links; media storage вне продукта |
| История | Manual revisions и технические snapshots в пользовательском потоке | REPLACE | Session-level diff и append-only restore |
| UI brand | Corporate assets/tokens | DELETE | Дизайн-код «Редакционный эфир» в CP7 |
| Документация | Product Reset docs плюс противоречащий исторический набор | ADAPT/DELETE | Только актуальные contracts/runbooks; Git history хранит удалённое |

## Защищённое поведение до замены

- Пользовательское поведение табличного редактора и CaptionPanels сначала закрепляется characterization-тестами.
- В Commit 1.1 runtime editor и `backend/app/services/bootstrap.py` не изменяются.
- Параллельный v2 runtime и папка `legacy` не создаются.
