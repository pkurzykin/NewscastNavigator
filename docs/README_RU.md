# Документация Newscast Navigator

Дата актуализации: 2026-04-22

## ACTIVE: рабочие документы в `docs/`
- `PROJECT_WORKFLOW_ARCHITECTURE_RU.md` — source of truth по карточке сюжета и newsroom-workflow.
- `STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md` — полный срез состояния проекта и план ближайших шагов.
- `ENGINEERING_PLAN_RU.md` — инженерные ограничения и правила реализации.
- `DEPLOYMENT_UBUNTU_RU.md` — production-схема и сопровождение.
- `LOCAL_DEV_WORKFLOW_RU.md` — рекомендуемый локальный dev-процесс.
- `WEB_SMOKE_CHECKLIST_RU.md` — ручной smoke-check перед/после заметных изменений.
- `LEGACY_DATA_MIGRATION_RU.md` — runbook повторного импорта legacy-данных при необходимости.
- `BRAND_GUIDELINES_TRANSNEFT_RU.md` — бренд-токены и правила UI на основе брендбука Транснефти.

## DESIGN: активные дизайн-спеки
- `superpowers/specs/2026-04-29-ui-redesign-concept-design.md` — согласованная концепция UI-редизайна: role-aware dashboard, список сюжетов, карточка сюжета, приоритеты, русский UX-словарь и ограничение “не ломать редактор”.
- `superpowers/plans/2026-04-29-ui-redesign-implementation-plan.md` — пошаговый план внедрения редизайна с контрольными точками для пользователя и задачами для агента.

## CONTRACT: живые интеграционные документы в `docs/contracts/`
- `INTEGRATION_ROADMAP_RU.md` — интеграционная дорожная карта `NewscastNavigator` + `CaptionPanels` + future `Premiere`.
- `STORY_EXCHANGE_RFC_RU.md` — контракт Story Exchange v1.

## ARCHIVE: завершенные и исторические материалы
- Путь: `docs/archive/2026-04/`.
- В архиве лежат закрытые sprint-чеклисты, завершенные migration/cleanup планы и RFC/UX документы, решения из которых уже реализованы.
- Исторические документы не возвращаются в рабочий корень `docs/` без явной причины.

## Правило чистоты `docs/`
- В корне `docs/` храним только текущие source-of-truth и runbook документы.
- Контракты, которые остаются рабочими, живут в `docs/contracts/`.
- Завершенные документы сразу переносим в `docs/archive/<YYYY-MM>/`.
