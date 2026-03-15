# Документация Newscast Navigator

Дата актуализации: 2026-03-15

## Актуальные документы
- `WEB_MIGRATION_PLAN_RU.md` — основной план перехода на полноценный web (backend + frontend).
- `WEB_PARITY_AUDIT_RU.md` — карта паритета между legacy Streamlit и новым web-контуром; основной чек-лист для завершения миграции и cleanup.
- `WEB_SMOKE_CHECKLIST_RU.md` — ручной smoke-check нового web-контура: роли, MAIN/ARCHIVE, EDITOR, WORKSPACE, история и экспорт.
- `REPOSITORY_CLEANUP_PLAN_RU.md` — поэтапный план очистки репозитория и отделения legacy без риска сломать текущую миграцию.
- `DEPLOYMENT_UBUNTU_RU.md` — текущий статус и безопасный порядок подготовки web-deploy; с отдельной пометкой, что на домашнем сервере уже работает какая-то версия проекта и перед деплоем нужен аудит.
- `SERVER_AUDIT_CHECKLIST_RU.md` — инвентаризация домашнего сервера перед первым deploy нового web-контура.
- `SPRINT1_BOOTSTRAP_RU.md` — пошаговый запуск и проверка нового web-контура (backend + frontend + postgres).
- `SPRINT2_MAIN_ACTIONS_RU.md` — тестирование операций MAIN/ARCHIVE и проверка ролей.
- `SPRINT3_EDITOR_CORE_RU.md` — тестирование экрана EDITOR: таблица, добавление/удаление строк, валидации и ограничения архива.
- `SPRINT4_WORKSPACE_EXPORT_RU.md` — тестирование проектных файлов/комментариев и экспорта DOCX/PDF.

## Архив (история Streamlit MVP)
- Папка: `docs/archive/streamlit_mvp/`
- Здесь лежат старые этапные чек-листы и UI-документы по MVP на Streamlit.
- Эти документы не используются как основа для новой архитектуры, но сохранены для истории.

## Правило чистоты docs
- В корне `docs/` оставляем только актуальные документы по текущему этапу.
- Устаревшие материалы переносим в `docs/archive/...`.
