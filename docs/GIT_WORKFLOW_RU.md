# Git workflow NewscastNavigator

Дата актуализации: 24 июля 2026 года.

## Правила

- `main` не меняется напрямую;
- одна логическая задача выполняется в отдельной ветке/worktree;
- перед изменениями проверяются branch, status и base SHA;
- сначала failing test, затем минимальная реализация;
- checkpoint завершается tests, self-review и небольшим local commit;
- push, PR, merge и deploy выполняются только по отдельной команде владельца.

Имена веток: `feat/*`, `fix/*`, `docs/*`, `refactor/*`, `build/*`,
`infra/*`. Product Reset выполняется в `feat/product-reset`.

## Перед commit

```bash
git status --short --branch
git diff --stat
git diff --check
```

Backend:

```bash
cd backend
python -m pip install --require-hashes -r requirements-dev.lock
pytest -q
python -m pip check
python scripts/check_dependency_licenses.py --repo-root ..
```

Frontend:

```bash
cd frontend
npm ci
npm test -- --run
npm run build
```

Не коммитятся `.env`, secrets, реальные datasets, screenshots/evidence,
`node_modules`, virtualenvs и `artifacts/product-reset/`. Lock-файлы коммитятся
вместе с изменившими их dependency inputs.

## Review

Сначала просматриваются `git diff --stat` и `git diff --name-only`, затем
точечные diffs. Review должен проверить:

- соответствие `docs/product-reset/SPEC_RU.md`;
- отсутствие второго runtime/source of truth;
- permissions и server-side gates;
- autosave local-authoritative contract;
- synthetic-only data;
- current docs и удаление заменённого кода.

Один сюжет — один актуальный сценарий.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
