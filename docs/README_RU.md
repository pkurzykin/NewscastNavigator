# Документация NewscastNavigator

Дата актуализации: 26 сентября 2026 года.

## Начало задачи

[PROJECT_STATE_RU.md](PROJECT_STATE_RU.md) — короткий актуальный контекст,
завершённые этапы, ограничения и следующий шаг. Не читать весь журнал при
каждом запуске агента.

## Действующие требования

- [product/SPEC_RU.md](product/SPEC_RU.md) — спецификация продукта;
- [product/EVAL_RUBRIC_RU.md](product/EVAL_RUBRIC_RU.md) — критерии готовности.

Первоначальный Product Reset завершён. Его разрешение пересобрать прототип
не распространяется на рабочую БД VDS. Продуктовая модель сохраняется:
Один сюжет — один актуальный сценарий.

## Текущие документы

- [ARCHITECTURE_RU.md](ARCHITECTURE_RU.md) — runtime и границы областей;
- [CAPTIONPANELS_CONTRACT_RU.md](CAPTIONPANELS_CONTRACT_RU.md) — актуальный export;
- [HOME_TEST_WORKFLOW_RU.md](HOME_TEST_WORKFLOW_RU.md) — постоянный LAN-only HTTPS;
- [RELEASE_WORKFLOW_RU.md](RELEASE_WORKFLOW_RU.md) — приёмка и выпуск на VDS;
- [PROJECT_AGENTS_RU.md](PROJECT_AGENTS_RU.md) — узкие роли и делегирование;
- [LOCAL_DEV_WORKFLOW_RU.md](LOCAL_DEV_WORKFLOW_RU.md) — изолированные dev/test tools;
- [ENGINEERING_PLAN_RU.md](ENGINEERING_PLAN_RU.md) — инженерные ограничения;
- [GIT_WORKFLOW_RU.md](GIT_WORKFLOW_RU.md) — ветки, снимки и review;
- [Hostland](../deploy/hostland/README.md) — production, копии и recovery;
- [DEPLOYMENT_UBUNTU_RU.md](DEPLOYMENT_UBUNTU_RU.md) — изолированный demo Compose;
- [WEB_SMOKE_CHECKLIST_RU.md](WEB_SMOKE_CHECKLIST_RU.md) — фактический smoke;
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — зависимости и лицензии.

Новые утверждённые планы задач сохраняются в `docs/plans/`; этот каталог
создаётся при первой соответствующей задаче.

## История и доказательства

- [product-reset/PROGRESS.md](product-reset/PROGRESS.md) — накопленный журнал;
- [первоначальный план](product-reset/IMPLEMENTATION_PLAN_RU.md) и
  [старые Plan/Goal prompts](product-reset/GOAL_PROMPTS_RU.md) — исторические,
  не инструкция повторить reset;
- [risk register](product-reset/RISK_REGISTER_RU.md), inventories и eval
  artifacts — доказательства соответствующих checkpoints;
- [demo runbook](product-reset/DEMO_RUNBOOK_RU.md) — прежний изолированный
  демонстрационный путь, не production deploy;
- `superpowers/` — сохранённые планы и результаты переезда на Hostland.

Пути истории сохраняются для ссылок и evaluator. Старые SPEC/EVAL содержат
только указатели на `product/`; второго экземпляра требований нет.
История Git хранит удалённые противоречащие legacy-документы.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
