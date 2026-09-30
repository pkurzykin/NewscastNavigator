---
type: policy
status: active
owner: development
audience: developers, agents
reviewed: 2026-09-30
---

# Инженерные правила NewscastNavigator

## Инварианты

- React + FastAPI + PostgreSQL + Docker;
- один актуальный сценарий и единая продуктовая модель в раздельных test/production средах;
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

1. Для изменения поведения сначала воспроизводящий failing test.
2. Минимальная реализация.
3. Удаление заменённого кода и документа в том же checkpoint.
4. Проверки затронутого поведения и регрессий по риску; для UI — browser evidence.
5. `git diff --check`, осмысленный локальный commit.

Обновление профильных документов входит в тот же checkpoint. Основной
порядок — [стандарт документации](../DOCUMENTATION_POLICY_RU.md). Существенная
задача завершается с проверкой `documentation-steward`, актуальной точкой
продолжения, отчётом и закрытым планом. Для редакционной правки документа
достаточно структурной проверки и чтения; тесты нужны для проверяющего кода.

Бизнес-переходы не кодируются произвольным status setter. Autosave ack не
заменяет весь editor state. Поздняя мелкая правка не снимает proofread
автоматически.

## Выбор проверок по задаче

- Документация: `python3 scripts/check_docs.py`, тесты checker и затронутые
  document/repository policy tests, содержательное ревью и `git diff --check`.
- Конфигурации агентов: TOML, роли/модели/ограничения и доступность загрузки.
- Backend/frontend поведение: failing regression, релевантные тесты,
  доступный полный набор; для UI — реальный browser-сценарий.
- Deploy/migration/backup/restore: inventory и изолированная репетиция
  затронутого эксплуатационного пути, совместимость и recovery evidence.

Недоступные проверки явно записываются NOT_RUN с причиной. Их нельзя
заменять утверждением полного PASS. Не устанавливать зависимости и не
поднимать приложение на MacBook ради чисто документной правки.
Постоянная интеграционная приёмка — [дома](../operations/HOME_TEST_WORKFLOW_RU.md);
выпуск — по [RELEASE_WORKFLOW_RU.md](../operations/RELEASE_WORKFLOW_RU.md).

## Проверки приложения

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
