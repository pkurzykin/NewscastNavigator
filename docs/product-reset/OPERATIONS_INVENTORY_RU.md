# NewscastNavigator — актуальный operations inventory

Ранний проход для дизайн-системы и R-001–R-011: 15 сентября 2026, ветка `codex/ui-system`,
сверка tracked paths на `bae6f9b`. Этот список заменяет исторический inventory Product Reset;
старые классификации и удалённые legacy-файлы доступны в Git history и не являются планом повторного удаления.

`KEEP` сохраняет назначение и существующий путь. Финальная работоспособность подтверждается
отдельным clean-deploy rehearsal после всех изменений, а не самой этой классификацией.
В данном проходе новых оснований для `REPLACE`/`DELETE` эксплуатационных путей нет.

| Файл | Решение | Основание / финальная проверка |
|---|---|---|
| `.env.example` | KEEP | Только пример конфигурации; реальные env/секреты не читаются. |
| `.github/workflows/ci.yml` | KEEP | Существующие CI gates; полная проверка после интеграции. |
| `backend/.dockerignore` | KEEP | Фильтрация контекста сборки и исключение локальных данных/секретов. |
| `backend/.env.example` | KEEP | Только пример конфигурации; реальные env/секреты не читаются. |
| `backend/Dockerfile` | KEEP | Существующий build/proxy/static path; MUI собирается в frontend assets. |
| `backend/Dockerfile.prod` | KEEP | Существующий build/proxy/static path; MUI собирается в frontend assets. |
| `backend/app/api/routes/health.py` | KEEP | Существующий health endpoint. |
| `backend/app/services/demo_seed.py` | KEEP | Синтетический seed; bootstrap шаблон нового пользовательского сюжета не меняет fixture seed. |
| `backend/app/services/runtime_setup.py` | KEEP | Существующий канонический runtime/administration path; новая параллельная реализация не требуется. |
| `backend/migrations/README` | KEEP | Единственный Alembic path; новый основной шрифт добавляется следующей миграцией, прежние сохраняются. |
| `backend/migrations/env.py` | KEEP | Единственный Alembic path; новый основной шрифт добавляется следующей миграцией, прежние сохраняются. |
| `backend/migrations/script.py.mako` | KEEP | Единственный Alembic path; новый основной шрифт добавляется следующей миграцией, прежние сохраняются. |
| `backend/migrations/versions/20260710_0001_product_reset.py` | KEEP | Единственный Alembic path; новый основной шрифт добавляется следующей миграцией, прежние сохраняются. |
| `backend/migrations/versions/20260730_0002_user_sessions.py` | KEEP | Единственный Alembic path; новый основной шрифт добавляется следующей миграцией, прежние сохраняются. |
| `backend/migrations/versions/20260730_0003_rubric_name_key.py` | KEEP | Единственный Alembic path; новый основной шрифт добавляется следующей миграцией, прежние сохраняются. |
| `backend/migrations/versions/20260806_0004_story_duration_text.py` | KEEP | Единственный Alembic path; новый основной шрифт добавляется следующей миграцией, прежние сохраняются. |
| `backend/scripts/bootstrap_admin.py` | KEEP | Существующий канонический runtime/administration path; новая параллельная реализация не требуется. |
| `backend/scripts/check_dependency_licenses.py` | KEEP | Проверка разрешений/уведомлений зависимостей, включая MUI/Emotion. |
| `backend/scripts/import_demo_dataset.py` | KEEP | Валидация демонстрационного набора; реальные данные не используются в автоматических проверках. |
| `backend/scripts/manage_users.py` | KEEP | Существующий канонический runtime/administration path; новая параллельная реализация не требуется. |
| `backend/scripts/product_reset_eval.py` | KEEP | Канонический сбор evidence и итоговых gates. |
| `backend/scripts/render_synthetic_scenario_docx.py` | KEEP | Локальный синтетический DOCX render QA; повторить для обеих основных гарнитур. |
| `backend/scripts/seed_demo.py` | KEEP | Синтетический seed; bootstrap шаблон нового пользовательского сюжета не меняет fixture seed. |
| `backend/scripts/validate_demo_dataset.py` | KEEP | Валидация демонстрационного набора; реальные данные не используются в автоматических проверках. |
| `compose.test.yaml` | KEEP | Изолированные PostgreSQL-тесты на синтетических данных. |
| `compose.yaml` | KEEP | Каноническая локальная разработка. |
| `deploy/README.md` | KEEP | Существующий runbook; актуализировать только при фактическом изменении команды. |
| `deploy/compose.demo.yaml` | KEEP | Канонический демонстрационный deploy; внешний запуск отдельно разрешает пользователь. |
| `deploy/env/demo.env.example` | KEEP | Только пример конфигурации; реальные env/секреты не читаются. |
| `deploy/nginx/.dockerignore` | KEEP | Фильтрация контекста сборки и исключение локальных данных/секретов. |
| `deploy/nginx/Dockerfile` | KEEP | Существующий build/proxy/static path; MUI собирается в frontend assets. |
| `deploy/nginx/nginx.conf` | KEEP | Существующий build/proxy/static path; MUI собирается в frontend assets. |
| `deploy/nginx/templates/newscast-web.conf.template` | KEEP | Существующий build/proxy/static path; MUI собирается в frontend assets. |
| `deploy/scripts/backup_db.sh` | KEEP | Checksum dump и восстановление только в пустую изолированную БД; проверить основной шрифт после Task5. |
| `deploy/scripts/install_systemd_unit.sh` | KEEP | Существующий эксплуатационный путь; команды внешнего сервера не выполняются. |
| `deploy/scripts/install_tls_bundle.sh` | KEEP | Существующий эксплуатационный путь; команды внешнего сервера не выполняются. |
| `deploy/scripts/rehearse_clean_deploy.sh` | KEEP | Канонический exact-commit build/migrate/seed/smoke/backup/restore/cleanup; финальный прогон обязателен. |
| `deploy/scripts/restore_db.sh` | KEEP | Checksum dump и восстановление только в пустую изолированную БД; проверить основной шрифт после Task5. |
| `deploy/scripts/scan_source_context.py` | KEEP | Фильтрация контекста сборки и исключение локальных данных/секретов. |
| `deploy/scripts/smoke.sh` | KEEP | Health/static assets и authenticated DOCX smoke; интерфейсы сохраняются. |
| `deploy/scripts/status_demo_stack.sh` | KEEP | Существующий эксплуатационный путь; команды внешнего сервера не выполняются. |
| `deploy/scripts/uninstall_systemd_unit.sh` | KEEP | Существующий эксплуатационный путь; команды внешнего сервера не выполняются. |
| `deploy/scripts/update_demo_stack.sh` | KEEP | Существующий эксплуатационный путь; команды внешнего сервера не выполняются. |
| `deploy/systemd/newscast-web-compose.service` | KEEP | Существующий эксплуатационный путь; команды внешнего сервера не выполняются. |
| `deploy/systemd/newscast-web.env.example` | KEEP | Только пример конфигурации; реальные env/секреты не читаются. |
| `frontend/.dockerignore` | KEEP | Фильтрация контекста сборки и исключение локальных данных/секретов. |
| `frontend/.env.example` | KEEP | Только пример конфигурации; реальные env/секреты не читаются. |
| `frontend/Dockerfile` | KEEP | Существующий build/proxy/static path; MUI собирается в frontend assets. |
| `frontend/Dockerfile.prod` | KEEP | Существующий build/proxy/static path; MUI собирается в frontend assets. |
| `frontend/nginx.prod.conf` | KEEP | Существующий build/proxy/static path; MUI собирается в frontend assets. |

## Изменения текущего плана

- MUI/Emotion входят в обычный frontend build и существующий dependency/license inventory.
- Удаление архива использует проверенные FK CASCADE; новый cleanup-, backup- или file-deletion script не нужен.
- Task5 добавит additive migration основного шрифта в существующий Alembic path. Текущий snapshot,
  revision history и backup/restore должны сохранять её поле; этот gate пока открыт.
- Канонических путей три: local `compose.yaml`, PostgreSQL tests `compose.test.yaml`, demo `deploy/compose.demo.yaml`.
  Временный override локального порта тестовой БД находится в OS temp и не создаёт новый путь проекта.
- Выполнена локальная PostgreSQL проверка каскада, шаблона и обеих гонок delete/restore: 17 passed.
  Полный clean build/seed/health/smoke/backup/restore и очистка тестового compose-project ещё не выполнены.
- Домашние/рабочие серверы, реальные env, секреты и внешние файлы материалов не затрагиваются.

## Финальный проход

Открыт до окончания Task5/Task7. После exact-commit rehearsal здесь фиксируются SHA, путь к manifest,
результаты migration/seed/smoke/backup/restore/cleanup и окончательные KEEP/ADAPT решения.
