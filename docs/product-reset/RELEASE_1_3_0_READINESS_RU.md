# Подготовка NewscastNavigator 1.3.0

Статус: проверка перед интеграцией; deploy, тег и GitHub Release не разрешены.

## Основание и границы

Пользователь 21 сентября поручил автономно подготовить следующий релиз,
включая push, PR, review и merge, если они не запускают deploy. Это разрешение
относится к уже утверждённым изменениям Product Reset, а не к новой модели.
Отдельным уточнением разрешён CodeRabbit CLI по рекомендациям задачи
«Ревью CodeRabbit бесплатно». Запрет CodeRabbit прежнего UI-этапа к этой
релизной проверке не относится. Платные usage credits не используются.

Исходный HEAD: `fd408064e8acdd65df886bd160ef5dee77e78d6a`.
После fetch `origin/main`: `d7a0300f8e68e24c7dd5aafb8a9ce02bf48df26f`.
Ветка опережает main на 63 коммита и не отстаёт. Последний тег — `v1.2.0`.
Исходная ветка занята другим worktree; подготовка ведётся отдельно
в `codex/release-1-3-0`, без переписывания исходной истории.

По принятому Semantic Versioning выбран MINOR `1.3.0`: основной шрифт
сценария, начальный шаблон, архивное удаление, копирование материалов и
подробное сравнение истории добавляют совместимые возможности. Публичные
CaptionPanels aliases и модель одного актуального сценария сохраняются.

## File-level план

1. Обновить `backend/pyproject.toml`, `backend/app/core/version.py`,
   `frontend/package.json` и два корневых поля `frontend/package-lock.json`.
   Сначала проверить RED в `backend/tests/test_app_version.py` и
   `frontend/src/components/AppFooter.test.tsx`, затем GREEN.
2. Добавить русскую запись в `frontend/src/features/release-notes/releaseNotes.ts`
   и `CHANGELOG.md`; сохранить историческую запись 1.2.0. Уточнить подпись
   в `WhatsNewDialog.tsx`. Обновить `releaseNotes.test.ts`, `AppShell.test.tsx`,
   `frontend/e2e/editorial-air.spec.ts`, `scenario-access.spec.ts`,
   `frontend/playwright.config.ts` и `frontend/src/test/playwrightConfig.test.ts`.
   Проверить первый показ после уже просмотренной 1.2.0, закрытие и reload.
3. Актуализировать `docs/product-reset/PROGRESS.md`, этот отчёт,
   `OPERATIONS_INVENTORY_RU.md` и правило review в `docs/design/UI_SYSTEM_RU.md`.
   Полные pytest/Vitest/build/Playwright, Compose и policy checks;
   чистый локальный rehearsal на отдельном Compose project, затем review.
4. Коммит, push без tags, PR в main, CI, исправления и merge без deploy.
   Проверить SHA/tree и CI после merge, безопасно синхронизировать main.

## Аудит запуска внешних действий

- Единственный активный workflow `.github/workflows/ci.yml` запускается на
  PR и push main: backend, frontend и изолированные PostgreSQL policy tests.
  В нём нет deploy, SSH, публикации пакетов, GitHub Release или создания тегов.
- GitHub repository webhooks: пустой список по API на момент preflight.
- `package.json` не имеет install/publish lifecycle scripts; локальный
  `core.hooksPath` не задан. Push выполняется с отключённым follow-tags.
- `update_demo_stack.sh` выполняет fetch и меняет runtime только при явном
  запуске с полным SHA. Systemd запускает Compose при start/reload, GitHub
  workflow его не вызывает. TLS/install/uninstall scripts тоже явные команды.
- `rehearse_clean_deploy.sh` работает только с именем
  `nn-product-reset-eval-*`, чистым committed HEAD, временным архивом Git,
  синтетическими данными и собственными source/restore projects.
- Реальные env, server-side hooks и конфигурация серверов не читались;
  доступ к домашнему/демонстрационному серверу в эту подготовку не входит.

## Проверки и следующий шаг

Результаты текущего exact-commit прогона, review и интеграции будут записаны
сюда после завершения. Исторические результаты не считаются текущим gate.
Новая миграция `20260914_0005` требует predeploy backup; откат схемы удаляет
font-aware compact retry cache, поэтому откат релиза планируется вместе с БД.

Следующая команда на разрешённом серверном checkout после отдельной команды
владельца: `./deploy/scripts/update_demo_stack.sh --ref <полный merge SHA>`.
До неё отдельно проверяются наличие SHA в remote сервера, predeploy backup
и его checksum. Подготовка не обновляет серверное Git-зеркало.

### Локальные проверки после релизных правок

- Backend: 1074 passed / 4 PostgreSQL-only skips, 326.49 s. Отдельная PostgreSQL:
  39 passed, включая все четыре пропуска, migration/default-font/autosave/archive.
- Frontend: после найденного review P1 — 627 passed / 62 files; build PASS,
  1089 modules. Regression восстановления: RED → 43 autosave tests GREEN.
- Browser: повторный полный прогон 169 passed / 2 BFCache skips из 171,
  1366×768, 1920×1080 и wide-layout 2560×1440. Новый popup дополнительно
  проверяет обновление после просмотренной 1.2.0 и геометрию на двух viewport.
- Compose local/test/demo, bash syntax, dependency/license policy, pip check:
  PASS. Реальные env не читаются. Логи: `artifacts/product-reset/V1_3_0/`.
- Исправленный P1: повторное продвижение серверной редакции во время
  восстановления больше не заменяет `conflict.localDraft` серверным snapshot;
  сохраняются текст, ручное оформление и основной шрифт до подтверждения PUT.
- CodeRabbit frontend/src: 136 files, 0 issues. Backend: 40 files, 1 major
  передан на проверку валидности. Это не окончательный допуск к merge.
