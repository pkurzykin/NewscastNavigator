# Newscast Navigator: срез состояния и следующие шаги

Дата: 2026-04-23
Ветка анализа: `main`

## 1. Executive summary

Проект находится в рабочем `web-only` состоянии. Базовый newsroom-workflow уже поддерживается end-to-end внутри карточки проекта: текст, ревизии, треки, правки, история, материал-ссылки, пользовательские роли и интеграционный экспорт.

Технический контур стабилен:

- backend тесты проходят (`45 passed`);
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
- editor/workspace с комментариями, материалами и файлами;
- ревизии и diff-поток;
- управление пользователями и password lifecycle.

Технический хвост:

- базовый frontend tech-pass запущен: добавлены lazy-loading страниц и rollup manual chunks;
- стартовый бандл сокращен, warning по размеру чанков снят;
- следующая задача — проверить UX/perf тяжелых сценариев в `Editor` под реальной нагрузкой.

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

Частично выполнены:

- интеграционный слой для downstream-расширений beyond CaptionPanels;
- инфраструктурный внешний hardening до финального production-perimeter.
- frontend tech-pass по производительности тяжелых экранов.

## 4. Приоритетный план следующих действий

### Priority A: workflow UX стабилизация

- статус: выполнено;
- персональная очередь, lifecycle action-комментариев и сигнал "текст изменился после постановки" уже в продакшен-коде.

### Priority B: contracts + integration hardening

- status: в работе, repo-side baseline усилен 2026-04-23;
- закрепить стабильный интеграционный контракт на уровне `docs/contracts`;
- проверить, что все обязательные поля/идентификаторы для CaptionPanels и будущего Premiere-потока покрыты тестами;
- избегать ad-hoc расширений формата без версии контракта.

### Priority C: frontend tech-pass

- status: в работе (phase 1 выполнен);
- route-level/code splitting и vendor-splitting уже внедрены;
- провести целевую проверку производительности тяжёлых экранов;
- сохранить текущую поведенческую модель UI без регрессий.

### Priority D: operations/security completion

- финализировать внешний доступ через контролируемую точку входа;
- завершить rollout реальных учеток по всем ролям;
- пройти повторный smoke-check на production-профиле конфигурации.

## 5. Правило работы с этим документом

- Обновлять документ после каждого заметного блока работ.
- Не смешивать в нем идеи и фактическое состояние: только проверяемые итоги и приоритетные шаги.
- Для исторических решений ссылаться на `docs/archive/<YYYY-MM>/`, а не возвращать старые планы в активный контур.
