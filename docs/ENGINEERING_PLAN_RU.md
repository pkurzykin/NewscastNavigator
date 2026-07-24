# Инженерные правила NewscastNavigator

## Инварианты

- React + FastAPI + PostgreSQL + Docker;
- один актуальный сценарий, один runtime-контур;
- server-side permissions и конкретные domain commands;
- editor local-authoritative во время ввода;
- stable row IDs до первого save;
- synthetic-only automated data;
- секреты и runtime `.env` вне Git.

Новая production dependency требует обоснования. Python inputs находятся в
`requirements.txt`, locks — в `requirements.lock` и `requirements-dev.lock`.
Docker и CI устанавливают locks только с `--require-hashes`. Frontend использует
`npm ci`.

## Изменения

1. Сначала failing test.
2. Минимальная реализация.
3. Удаление заменённого кода и документа в том же checkpoint.
4. Relevant tests, полный доступный suite и browser evidence.
5. `git diff --check`, осмысленный локальный commit.

Бизнес-переходы не кодируются произвольным status setter. Autosave ack не
заменяет весь editor state. Поздняя мелкая правка не снимает proofread
автоматически.

## Проверки

```bash
cd backend
pytest -q
python -m compileall app migrations scripts
python -m pip check
python scripts/check_dependency_licenses.py --repo-root ..

cd ../frontend
npm ci
npm test -- --run
npm run build

cd ..
docker compose --env-file .env.example -f compose.yaml config
docker compose -f compose.test.yaml config
docker compose --env-file deploy/env/demo.env.example \
  -f deploy/compose.demo.yaml config
```

Внешние действия, реальные демоданные и deploy выполняются только после
отдельного разрешения. Один сюжет — один актуальный сценарий.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
