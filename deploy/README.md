# Deploy

В репозитории два пользовательских пути запуска и отдельный test harness:

- local: `compose.yaml`;
- demo: `deploy/compose.demo.yaml`;
- tests: `compose.test.yaml`.

Demo path использует production images, read-only filesystem где возможно,
`no-new-privileges`, внутренние backend/frontend ports и единственный gateway.

## Demo environment

```bash
cp deploy/env/demo.env.example deploy/env/demo.env
```

Заменить все `change-this-*`, задать только разрешённые HTTPS origins и оставить
bind `127.0.0.1`, пока внешний perimeter отдельно не утверждён.

```bash
docker compose \
  --project-name newscast_navigator_demo \
  --env-file deploy/env/demo.env \
  -f deploy/compose.demo.yaml \
  up -d --build --wait
```

Статус и smoke:

```bash
./deploy/scripts/status_demo_stack.sh
./deploy/scripts/smoke.sh --compose-file deploy/compose.demo.yaml
```

Без credentials результат содержит `"authenticated":false` и
`"docx_export":false`. Если через окружение одновременно переданы
`SMOKE_USERNAME` и `SMOKE_PASSWORD`, smoke выбирает первый доступный сюжет,
читает его canonical scenario, формирует expectation из этого ответа и
проверяет POST DOCX: status `200`, exact content type, attachment,
`Cache-Control: no-store`, ненулевой ZIP. Cookie, пароль, текст сюжета и байты
DOCX не печатаются; клиентский файл находится только во временном каталоге
smoke и удаляется существующим trap. Server temp и application storage этот
путь не расширяет.

Локальный render-артефакт для 1.1.0 создаётся только из синтетического снимка:

```bash
cd backend
./.venv/bin/python scripts/render_synthetic_scenario_docx.py \
  --output ../artifacts/product-reset/V1_1_0/docx-export/synthetic-scenario.docx
```

Helper не обращается к БД и не является deploy, recovery или runtime-route.
Он не подтверждает PDF, архив экспортов или встраивание файлов шрифтов.

Backup и restore используют `deploy/scripts/backup_db.sh` и
`deploy/scripts/restore_db.sh`. Restore разрешён только в пустую isolated eval
database; скрипт проверяет checksum и после восстановления выполняется
authenticated smoke.

Rollback release `1.1.0` из-за additive migration `20260806_0004` требует
одновременно вернуть сохранённые predeploy application images и восстановить
БД из predeploy backup каноническим recovery path. Одного отката образов или
ручного удаления колонки недостаточно. Любой такой rollback остаётся
permission-gated внешним действием.

Обновление demo допускается только отдельной командой владельца и exact
40-character commit SHA через `deploy/scripts/update_demo_stack.sh --ref`.
Внешний demo, remote dataset, push и deploy не являются частью локального CP7.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
