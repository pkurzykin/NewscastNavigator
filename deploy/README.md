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

Backup и restore используют `deploy/scripts/backup_db.sh` и
`deploy/scripts/restore_db.sh`. Restore разрешён только в пустую isolated eval
database; скрипт проверяет checksum и после восстановления выполняется
authenticated smoke.

Обновление demo допускается только отдельной командой владельца и exact
40-character commit SHA через `deploy/scripts/update_demo_stack.sh --ref`.
Внешний demo, remote dataset, push и deploy не являются частью локального CP7.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
