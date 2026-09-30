# Конфигурации и скрипты сред

| Среда | Конфигурация | Инструкция |
|---|---|---|
| Локальная разработка | `compose.yaml` | [Локальная среда](../docs/engineering/LOCAL_DEV_WORKFLOW_RU.md) |
| PostgreSQL-тесты | `compose.test.yaml` | [Проверки](../docs/engineering/DEVELOPMENT_RU.md) |
| Постоянный домашний тест | `deploy/home-test/compose.yaml` | [Домашний workflow](../docs/operations/HOME_TEST_WORKFLOW_RU.md) |
| Production Hostland | `deploy/hostland/production.compose.yaml` | [Production и recovery](../docs/operations/hostland/README.md) |
| Изолированный demo | `deploy/compose.demo.yaml` | [Demo deploy](../docs/operations/DEMO_DEPLOYMENT_RU.md) |

Скрипты находятся рядом с конфигурациями; основные инструкции — в
[эксплуатации](../docs/operations/README_RU.md). Последовательность команд,
условия применения и разрешения описываются там в одном месте.

Для выпуска используйте [процесс релиза](../docs/operations/RELEASE_WORKFLOW_RU.md).
Исторические проверки среды доступны через [отчёты](../docs/reports/README_RU.md).

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
