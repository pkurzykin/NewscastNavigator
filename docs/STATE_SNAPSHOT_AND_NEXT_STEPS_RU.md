# Newscast Navigator: срез состояния и следующие шаги

Дата: 2026-05-06
Ветка анализа: `main`

## 1. Executive summary

Проект находится в рабочем `web-only` состоянии. Базовый newsroom-workflow уже поддерживается end-to-end внутри карточки проекта: текст, ревизии, треки, правки, история, материал-ссылки, пользовательские роли и интеграционный экспорт.

Технический контур стабилен:

- backend тесты проходят (`48 passed`);
- frontend production build проходит;
- `main` синхронизирован с `origin/main`, последние UX/brand-изменения уже в удаленном репозитории.

Главный текущий риск не в отсутствии архитектуры, а в накопившейся продуктовой детализации:

- масштабирование текущего UI без роста технического долга;
- строгая дисциплина документации;
- доводка операционного security-периметра перед внешним rollout.

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

- main-очереди с фильтрами и сигналами фокуса;
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

Остается:

- завершить perimeter hardening внешнего доступа (домен/TLS/reverse proxy policy) как отдельный инфраструктурный этап.

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
- персональная очередь, lifecycle action-комментариев и сигнал "текст изменился после постановки" уже в продакшен-коде.

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

- status: deploy-stage blocker до публичного rollout;
- финализировать внешний доступ через контролируемую точку входа с рабочим доменом/TLS;
- завершить rollout реальных учеток по всем ролям без demo/default доступов;
- пройти повторный smoke-check на production-профиле конфигурации после infra-hardening.

## 5. Правило работы с этим документом

- Обновлять документ после каждого заметного блока работ.
- Не смешивать в нем идеи и фактическое состояние: только проверяемые итоги и приоритетные шаги.
- Для исторических решений ссылаться на `docs/archive/<YYYY-MM>/`, а не возвращать старые планы в активный контур.
