# Git Workflow Newscast Navigator

Дата актуализации: 2026-04-30
Статус: active source of truth для работы с git и GitHub

## 1. Зачем нужен документ

Этот документ фиксирует единый порядок работы с git для людей и агентов.

Цель:

- `main` всегда остается рабочим и деплоимым;
- каждая задача идет в отдельной ветке;
- изменения попадают в `main` только через PR;
- новый чат/агент стартует без догадок и не оставляет “висячие” локальные коммиты;
- production и deploy не расходятся с GitHub.

## 2. Базовая модель

Коротко:

```text
main
→ новая ветка под одну тему
→ изменения
→ проверки
→ commit
→ push
→ PR
→ review
→ merge в main
→ обновить локальный main
```

Что означает:

- `main` — основная линия проекта, должна быть рабочей.
- `branch` — отдельная линия работы под одну тему.
- `commit` — сохраненная осмысленная точка изменений.
- `push` — отправка ветки на GitHub.
- `PR` — предложение добавить ветку в `main`.
- `merge` — принятие PR в `main`.

## 3. Имена веток

Использовать такие префиксы:

- `feat/*` — новая пользовательская возможность;
- `fix/*` — исправление ошибки;
- `docs/*` — документация;
- `refactor/*` — структурное улучшение без изменения поведения;
- `chore/*` — обслуживание репозитория;
- `build/*` — сборка, зависимости, tooling;
- `infra/*` — deploy, nginx, systemd, docker, server/runbook.

Примеры:

```bash
docs/git-workflow-rules
feat/ui-redesign-task-1
fix/editor-autosave-state
infra/prod-backup-check
```

Одна ветка = одна логическая тема.

Не смешивать в одной ветке:

- UI feature и deploy;
- cleanup и продуктовую фичу;
- документацию и рискованный backend hotfix, если это не один явно связанный блок.

## 4. Старт новой задачи

Перед началом работы:

```bash
git switch main
git pull
git status --short --branch
```

Ожидаемо:

```text
## main...origin/main
```

Создать ветку:

```bash
git switch -c feat/example-task
```

Если задача только про документацию:

```bash
git switch -c docs/example-topic
```

## 5. Работа внутри ветки

Правило:

- делать маленькие осмысленные изменения;
- проверять после каждого заметного блока;
- коммитить только завершенный логический кусок.

Перед commit:

```bash
git status --short
git diff --check
```

Для frontend:

```bash
cd frontend && npm run build
```

Для backend, если менялся backend:

```bash
cd backend
./.venv/bin/python -m pytest -q
```

Если backend test env не настроен, явно написать это в отчете.

## 6. Commit

Коммиты должны быть короткими и понятными.

Формат:

```text
type: short description
```

Примеры:

```bash
git commit -m "docs: add git workflow rules"
git commit -m "feat: add project priority rules"
git commit -m "fix: preserve editor autosave state"
git commit -m "infra: document prod restore command"
```

Перед commit добавлять только нужные файлы:

```bash
git add docs/GIT_WORKFLOW_RU.md docs/README_RU.md
git commit -m "docs: add git workflow rules"
```

Не использовать `git add .` вслепую, если в рабочем дереве есть временные файлы или незнакомые изменения.

## 7. Push

После commit отправить ветку на GitHub:

```bash
git push -u origin branch-name
```

Пример:

```bash
git push -u origin docs/git-workflow-rules
```

После push ветка больше не “висячая” локально.

## 8. Pull Request

Создать PR:

```bash
gh pr create --base main --head branch-name --title "type: short title" --body "..."
```

Для незавершенной работы использовать draft PR:

```bash
gh pr create --draft --base main --head branch-name --title "feat: ..." --body "..."
```

PR body должен содержать:

- что изменено;
- как проверить;
- какие риски остались;
- если менялся UI — что смотреть в браузере;
- если менялся deploy — что изменится на сервере.

## 9. Merge

Перед merge:

- PR должен быть проверен;
- build/test/smoke должны быть описаны;
- пользователь должен утвердить merge, если изменения заметные или рискованные.

Merge через GitHub CLI:

```bash
gh pr merge PR_NUMBER --merge --delete-branch
```

После merge обновить локальный `main`:

```bash
git switch main
git pull
git fetch --prune origin
git status --short --branch
```

Ожидаемо:

```text
## main...origin/main
```

## 10. Как стартовать новый чат/агента

Новый чат должен начинать с конкретной ветки и конкретной задачи.

Шаблон:

```text
Работаем в /Volumes/work/Projects/NewscastNavigator.

Сначала подготовь ветку:

git switch main
git pull
git switch -c feat/example-task

Задача: выполнить только [описание/Task N] из [путь к плану].

Ограничения:
- не трогать unrelated файлы;
- не менять backend/API без явного решения;
- не трогать editor-core, если задача не про редактор;
- после изменения запустить нужные проверки;
- обновить чекбоксы плана только для реально выполненных шагов;
- сделать commit;
- в конце написать: что сделано, как проверить, какие риски остались.
```

Не нужно вставлять в новый чат всю историю обсуждения. Достаточно указать:

- путь к рабочему документу;
- номера задач;
- ограничения;
- ожидаемые проверки.

## 11. Что агент должен делать всегда

Перед изменениями:

```bash
git status --short --branch
```

Перед commit:

```bash
git diff --check
```

После commit:

```bash
git status --short --branch
```

После push:

```bash
git status --short --branch
```

В финальном отчете агент должен указать:

- текущую ветку;
- commit hash;
- что изменено;
- какие проверки выполнены;
- что не удалось проверить;
- нужна ли PR/merge операция.

## 12. Чего агенту нельзя делать без явного запроса

Запрещено без явного запроса пользователя:

- делать `git reset --hard`;
- делать `git checkout -- <file>` для отката чужих изменений;
- force push;
- rebase публичной ветки;
- удалять данные, backup, `.env`, volumes, storage;
- мержить PR с production/deploy/security последствиями;
- создавать теги и releases;
- пушить секреты, dump, logs, `frontend/dist`, временные БД.

Если появляется `index.lock`:

1. проверить, есть ли живой git-процесс;
2. только если lock stale, удалить его;
3. написать в отчете, что произошло.

## 13. Production и deploy

Production обновляется только через git + docker compose workflow.

Запрещено:

- править production руками и не переносить изменения в репозиторий;
- держать server-specific решения только на сервере;
- деплоить незакоммиченные локальные изменения;
- коммитить production `.env` или секреты.

Если на сервере сделана emergency-правка:

1. зафиксировать, что изменено;
2. перенести изменение обратно в репозиторий;
3. оформить branch/PR;
4. после merge обновлять production уже из git.

## 14. Рекомендуемый цикл для UI-редизайна

Для редизайна использовать маленькие ветки:

```text
feat/ui-redesign-task-1
feat/ui-redesign-priority
feat/ui-redesign-shell
feat/ui-redesign-dashboard
feat/ui-redesign-project-card
feat/ui-redesign-polish
```

Каждая ветка:

- стартует от свежего `main`;
- выполняет ограниченный кусок плана;
- проходит `cd frontend && npm run build`;
- дает браузерный checkpoint;
- идет в отдельный PR.

## 15. Если работа уже начата не на той ветке

Если изменения случайно сделаны в `main`, но еще не commit:

```bash
git switch -c feat/correct-branch-name
```

Изменения переедут в новую ветку.

Если commit уже сделан в `main`, не делать reset без явного решения. Сначала показать:

```bash
git log --oneline -3
git status --short --branch
```

И согласовать дальнейшее действие.
