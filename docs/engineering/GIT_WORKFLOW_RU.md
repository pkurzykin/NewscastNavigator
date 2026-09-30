---
type: policy
status: active
owner: development
audience: developers, agents
reviewed: 2026-09-30
---

# Git workflow NewscastNavigator

Дата актуализации: 26 сентября 2026 года.

## Правила

- `main` не меняется напрямую;
- одна логическая задача выполняется в отдельной ветке/worktree;
- перед изменениями проверяются branch, status и base SHA;
- сначала failing test, затем минимальная реализация;
- checkpoint завершается релевантными проверками, self-review и local commit;
- push, PR, merge и deploy выполняются только по отдельной команде владельца.

Новые ветки Codex по умолчанию: `codex/<задача>`. Существующие утверждённые
ветки сохраняются; явное имя владельца имеет приоритет.

## Один проверяемый снимок

Для существенной правки reviewer и отдельный verifier проверяют один commit
или manifest файлов. После исправлений повторяются затронутые проверки.
Commit домашней приёмки записывается полным SHA вместе с image IDs.
Результаты одного SHA не переносятся на изменённый кандидат автоматически.

Порядок интеграции и выпуска: [RELEASE_WORKFLOW_RU.md](../operations/RELEASE_WORKFLOW_RU.md).
Если merge/rebase меняет итоговый SHA, проверить diff, CI и домашнюю установку
нового кандидата. Push/PR/merge/tag/release/deploy остаются отдельными внешними
действиями с разрешением владельца. Тестовая БД не является частью Git-релиза.

## Перед commit

```bash
git status --short --branch
git diff --stat
git diff --check
```

Проверки выбираются по [ENGINEERING_PLAN_RU.md](DEVELOPMENT_RU.md).
Следующие команды относятся к изменениям приложения.

Команды проверки приложения находятся в [инженерных правилах](DEVELOPMENT_RU.md)
и README соответствующего компонента; не копируйте их в планы как отдельный
параллельный стандарт. Проверка документации:

```bash
python3 scripts/check_docs.py
```

Обновите затронутые основные документы вместе с изменением. Для существенной
задачи получите заключение [куратора документации](PROJECT_AGENTS_RU.md#куратор-документации),
закройте план и сохраните отчёт согласно [стандарту](../DOCUMENTATION_POLICY_RU.md).

Не коммитятся `.env`, secrets, реальные datasets, screenshots/evidence,
`node_modules`, virtualenvs и `artifacts/product-reset/`. Lock-файлы коммитятся
вместе с изменившими их dependency inputs.

## Review

Сначала просматриваются `git diff --stat` и `git diff --name-only`, затем
точечные diffs. Review должен проверить:

- соответствие `docs/product/SPEC_RU.md`;
- отсутствие второго runtime/source of truth;
- permissions и server-side gates;
- autosave local-authoritative contract;
- synthetic-only data;
- current docs и удаление заменённого кода.

Один сюжет — один актуальный сценарий.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
