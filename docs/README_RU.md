# Документация Newscast Navigator

Дата актуализации: 2026-03-16

## Актуальные документы
- `WEB_MIGRATION_PLAN_RU.md` — исходный архитектурный план и итог перехода на полноценный web.
- `WEB_PARITY_AUDIT_RU.md` — итоговая карта паритета между legacy и web; показывает, что было перенесено и что осталось как post-migration improvements.
- `WEB_SMOKE_CHECKLIST_RU.md` — ручной smoke-check нового web-контура: роли, MAIN/ARCHIVE, EDITOR, WORKSPACE, история и экспорт.
- `REPOSITORY_CLEANUP_PLAN_RU.md` — фиксирует завершенный cleanup и переход репозитория в `web-only`.
- `DEPLOYMENT_UBUNTU_RU.md` — актуальная production-схема: `/opt/newscast-web`, `docker compose`, `systemd`, update/backup path.
- `SERVER_AUDIT_CHECKLIST_RU.md` — чек-лист аудита сервера; оставлен как воспроизводимый runbook для новых инсталляций или повторной проверки.
- `LEGACY_DATA_MIGRATION_RU.md` — runbook повторного импорта legacy-данных из внешнего backup в чистую web-базу.
- `POST_CUTOVER_STABILIZATION_RU.md` — пост-cutover сопровождение, cleanup и day-2 операции.
- `SPRINT1_BOOTSTRAP_RU.md` — пошаговый запуск и проверка нового web-контура (backend + frontend + postgres).
- `SPRINT2_MAIN_ACTIONS_RU.md` — тестирование операций MAIN/ARCHIVE и проверка ролей.
- `SPRINT3_EDITOR_CORE_RU.md` — тестирование экрана EDITOR: таблица, добавление/удаление строк, валидации и ограничения архива.
- `SPRINT4_WORKSPACE_EXPORT_RU.md` — тестирование проектных файлов/комментариев и экспорта DOCX/PDF.

Исторический Streamlit-контур больше не лежит в `main`. Если нужен старый контекст, используй git history и server backups, а не рабочую документацию.

## Правило чистоты docs
- В корне `docs/` оставляем только актуальные документы по текущему этапу.
- Исторические материалы не возвращаем в рабочий набор документов без прямой причины.
