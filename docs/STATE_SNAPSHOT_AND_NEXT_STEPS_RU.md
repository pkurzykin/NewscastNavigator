# Newscast Navigator: срез состояния и следующие шаги

Дата: 2026-05-30
Ветка анализа: `feat/newsroom-production-smoke`

## 1. Executive summary

Проект находится в рабочем `web-only` состоянии. MVP newsroom UI stabilization доведен до production-smoke этапа: главный экран работает как общий `Реестр сюжетов`, карточка сюжета открывает видимую редактируемую таблицу текста сразу, а production-gates, правки, материалы, история и администрирование не конкурируют с основным workflow.

Технический контур стабилен:

- backend тесты проходят (`59 passed`);
- frontend production build проходит;
- PR7 smoke выполнен локально на ветке `feat/newsroom-production-smoke`: проверены login, реестр, создание `Исходники / материал`, создание `Сюжет в работу`, открытие карточки, видимость editor-core, production-gates, responsive registry snapshot и отдельная admin-навигация.

Главный текущий риск не в отсутствии архитектуры, а в операционном rollout:

- владелец должен задать реальные domain/DNS/TLS/secrets;
- production-аккаунты должны быть реальными, без demo/default credentials;
- публичный bind включается только после smoke-check и access policy.

Security smoke PR7 выявил существующие риски, которые закрываются отдельными `fix/*` PR, а не смешиваются с документационным smoke.

Закрыто после PR7:

- workspace upload больше не использует `project_file_root` как директорию записи и всегда остается внутри env-rooted storage (`STORAGE_PATH/projects/<id>`).
- download/delete вложений теперь также отклоняют уже сохраненный `ProjectFile.storage_path`, если путь выходит за пределы env-rooted storage.

Остается важный риск:

- rich-text HTML сохраняется и затем рендерится без явной sanitization boundary (`backend/app/services/structured_fields.py`, `frontend/src/pages/EditorPage.tsx`).

Дополнительный minor-риск: `GET /api/v1/users` доступен любому authenticated user и возвращает служебные user metadata; mutating user endpoints при этом admin-only.

## 2. Фактическое состояние по слоям

### 2.1 Backend/API

Реализовано:

- auth lifecycle: login, `me`, change password, временные пароли, требование смены пароля;
- user admin API: создание, обновление, деактивация, reset temporary password;
- project lifecycle: create/clone/archive/restore/list/meta update/history;
- editor/workspace API: строки текста, structured fields, material links, project files, comments;
- revisions API: create/list/detail/elements/diff/branch/submit/merge/approve/reject/restore/mark current;
- track APIs: `titles`, `edit`, `voiceover`, `final_review` статусы и синхронизация с текстом;
- export/integration API: DOCX/PDF/Story Exchange/CaptionPanels import.

### 2.2 Data model

Ключевые сущности:

- `Project`, `User`, `ScriptElement`, `ProjectEvent`;
- `ProjectRevision`, `ProjectRevisionElement`;
- `ProjectTextSnapshot`, `ProjectTextSnapshotElement`;
- `ProjectComment` (включая action lifecycle);
- `ProjectFile`, `ProjectMaterialLink`.

В модели уже зафиксированы инварианты newsroom-процесса:

- `workspace text` отделен от `current/check/proofread` состояния;
- история правок и действий привязана к пользователям и времени;
- изменения текста можно соотносить с комментариями и ревизиями.

### 2.3 Frontend

Реализовано:

- общий реестр сюжетов с фильтрами, сохраненными представлениями и сигналами фокуса;
- карточка сюжета в новом UI с вкладками `Обзор`, `Текст`, `Правки`, `Материалы`, `Производство`, `История`;
- editor/workspace с комментариями, материалами и файлами;
- ревизии и diff-поток;
- управление пользователями и password lifecycle.

RC-фиксация и следующий этап:

- базовый frontend tech-pass завершен для текущего RC: добавлены lazy-loading страниц и rollup manual chunks;
- стартовый бандл сокращен, warning по размеру чанков снят;
- UI-redesign этап карточки завершен: материалы, правки, производство и история вынесены из длинной страницы редактора в отдельные вкладки без изменения backend/API и editor-core;
- проверка UX/perf тяжелых сценариев в `Editor` на реальных больших данных вынесена в future performance validation и не блокирует текущий RC.

### 2.4 Security baseline

Сделано:

- устранены demo-patterns в runtime-конфигурации;
- внедрены проверки production-safe окружения;
- user/password lifecycle переведен в управляемую модель.
- production runtime теперь fail-fast блокирует demo seed, placeholder secrets, SQLite, wildcard/dev/plain HTTP CORS и активные demo/default users;
- production env examples по умолчанию держат edge reverse proxy на `127.0.0.1`, а не на публичном bind.

Остается:

- заполнить реальные server-side значения: домен, DNS, TLS bundle, secrets и production users;
- выполнить server rollout по `docs/DEPLOYMENT_UBUNTU_RU.md` и production smoke по `docs/WEB_SMOKE_CHECKLIST_RU.md`.

## 3. Что уже соответствует архитектурному плану

По крупным блокам архитектуры выполнено ориентировочно `85-90%`.

Выполнены полностью или почти полностью:

- foundation карточки сюжета;
- source of truth по тексту и ревизиям;
- основные workflow-треки;
- action comments и личные сигналы по работе;
- user administration и базовый security hardening.

Частично выполнены / вынесены в следующий этап:

- интеграционный слой для CaptionPanels стабилизирован; расширение в сторону Premiere вынесено в future roadmap;
- инфраструктурный внешний hardening до финального production-perimeter остается отдельным deploy-stage блоком перед публичным rollout;
- deep performance validation тяжелых экранов вынесена в отдельный этап после RC.

## 4. Актуальный план: RC / Future / Deploy

### Priority A: workflow UX стабилизация

- статус: выполнено;
- представления реестра для личной работы, lifecycle action-комментариев и сигнал "текст изменился после постановки" уже в продакшен-коде.

### Priority B: contracts + integration hardening

- status: закрыто для текущего RC;
- Story Exchange v1 и CaptionPanels adapter-contract зафиксированы в `docs/contracts`;
- backend smoke/API тесты покрывают stable ids и базовые mapping-правила (`48 passed`);
- дальнейшие изменения контракта допускаются только через versioning и отдельный RFC-шаг.

### Priority C: frontend tech-pass

- status: закрыто для текущего RC;
- route-level/code splitting и vendor-splitting уже внедрены;
- целевая проверка производительности тяжёлых экранов на реальных больших данных вынесена в future validation;
- поведенческая модель UI после редизайна зафиксирована как текущий baseline.

### Priority D: operations/security completion

- status: repository-side hardening закрыт, server-side rollout inputs остаются за владельцем;
- перед публичным rollout задать domain/DNS/TLS/secrets в production `.env`;
- создать/проверить реальные учетные записи и отключить любые demo/default users;
- оставить `NGINX_BIND_HOST=127.0.0.1` до финального открытия наружу или до внешнего reverse proxy;
- после включения публичного bind пройти production smoke-check и проверить отсутствие доступа по demo credentials.

## 5. Правило работы с этим документом

- Обновлять документ после каждого заметного блока работ.
- Не смешивать в нем идеи и фактическое состояние: только проверяемые итоги и приоритетные шаги.
- Для исторических решений ссылаться на `docs/archive/<YYYY-MM>/`, а не возвращать старые планы в активный контур.
