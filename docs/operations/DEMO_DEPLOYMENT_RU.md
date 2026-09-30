---
type: runbook
status: active
owner: operations
audience: operators, agents
reviewed: 2026-09-30
---

# Demo deploy на Ubuntu

Для будущего Hostland production (отдельный project, без demo-сборки) см.
закрытый [результат CP4–CP5](../archive/2026-hostland-migration/specs/2026-09-23-hostland-cp4-cp5-result.md)
и [production restore runbook](hostland/RESTORE_PRODUCTION.md).
Production уже работает на Hostland. Этот demo-контур не является его заменой;
текущее состояние см. в [точке продолжения](../PROJECT_STATE_RU.md).

## Граница

`deploy/compose.demo.yaml` — единственный канонический demo deploy. Выполнение на
внешнем сервере требует отдельного разрешения владельца. Документ не разрешает
push, remote access или deploy.

## Требования

- Ubuntu с Docker Engine и Compose plugin;
- checkout exact approved commit;
- локальный `deploy/env/demo.env`, созданный из example;
- TLS/access perimeter вне этого Compose;
- backup directory вне repository.

Нельзя использовать значения `change-this-*`, synthetic local secrets или
default credentials. `DEMO_BIND_HOST=127.0.0.1` сохраняется до отдельного
решения об открытии perimeter.

## Config и запуск

```bash
cp deploy/env/demo.env.example deploy/env/demo.env
docker compose \
  --project-name newscast_navigator_demo \
  --env-file deploy/env/demo.env \
  -f deploy/compose.demo.yaml config

docker compose \
  --project-name newscast_navigator_demo \
  --env-file deploy/env/demo.env \
  -f deploy/compose.demo.yaml up -d --build --wait
```

Production backend/frontend images не bind-mount runtime source. Backend и
gateway используют read-only root filesystem, tmpfs и
`no-new-privileges:true`.

## Bootstrap, seed и smoke

Первый начальник создаётся явной командой `scripts/bootstrap_admin.py` с
одноразовыми `BOOTSTRAP_ADMIN_*`. Автоматический synthetic seed в production
отключён.

```bash
./deploy/scripts/status_demo_stack.sh
./deploy/scripts/smoke.sh --compose-file deploy/compose.demo.yaml
```

Smoke проверяет health/root `200`, unauthenticated `/api/v1/auth/me` `401` и,
если переданы `SMOKE_USERNAME`/`SMOKE_PASSWORD`, authenticated story read.

## Backup и restore

```bash
BACKUP_DIR="${HOME}/newscast-backups/product-reset-demo"
BACKUP_FILE="$BACKUP_DIR/postgres.dump"
./deploy/scripts/backup_db.sh \
  --project-name newscast_navigator_demo \
  --compose-file deploy/compose.demo.yaml \
  --env-file deploy/env/demo.env \
  --output-file "$BACKUP_FILE"
```

Backup создаёт только exact dump и SHA-256 checksum. Restore не выполняется в
работающий demo project: он разрешён только в отдельную пустую isolated eval
database с другим project name, собственной сетью и volume.

```bash
PROJECT_NAME="nn-product-reset-eval-restore-$(date -u +%Y%m%d%H%M%S)"
COMPOSE_FILE="deploy/compose.demo.yaml"
ENV_FILE="deploy/env/demo.env"

cleanup() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" down -v --remove-orphans
}
trap cleanup EXIT

docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" up -d --wait db

./deploy/scripts/restore_db.sh \
  --project-name "$PROJECT_NAME" \
  --compose-file deploy/compose.demo.yaml \
  --env-file deploy/env/demo.env \
  --input "$BACKUP_FILE"
```

Полный counts comparison и authenticated smoke не воспроизводятся вручную:
канонический rehearsal сам создаёт distinct source/restore projects, делает
backup, empty restore, сравнение и гарантированный cleanup:

```bash
./deploy/scripts/rehearse_clean_deploy.sh \
  --project-name nn-product-reset-eval-final \
  --artifacts artifacts/product-reset/CP7/ops
```

Скрипты не печатают секреты. Atomic `latest-run.txt` публикует только rehearsal
после полного успеха; standalone backup-скрипт этот pointer не создаёт.

## Обновление

Только после отдельного разрешения:

```bash
./deploy/scripts/update_demo_stack.sh --ref "$APPROVED_SHA"
```

Скрипт принимает exact 40-character SHA, требует clean checkout и сверяет
fetched commit. Полный внешний порядок — [demo runbook](DEMO_RUNBOOK_RU.md).

Если config, health или smoke не проходят, не открывайте внешний доступ и не
импортируйте набор данных. Сохраните код ошибки и обезличенный результат,
проверьте отдельный Compose-проект и источник конфигурации; восстановление
разрешено только в пустую изолированную БД по процедуре выше.

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
