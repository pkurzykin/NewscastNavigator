# Внешний demo runbook

Этот runbook описывает только разрешённый checkpoint `EXT-DEMO`. Он не даёт
разрешения на remote access, push, deploy, backup или использование реальных
данных.

## Permission gate

До начала владелец отдельно утверждает:

1. exact 40-character app SHA;
2. remote target и demo deploy;
3. backup;
4. sanitized dataset;
5. сохранение redacted evidence.

Без любого разрешения `external_demo.status=blocked_permission`,
`hard_gates_passed=false`, `full_eval_passed=false`.

## Dataset

В repository остаётся только synthetic seed. Внешний набор передаётся вне Git и
должен содержать только разрешённые завершённые сюжеты, однословные
обезличенные имена, без контактов, секретов и реальных путей к материалам.

```bash
python backend/scripts/validate_demo_dataset.py \
  --input "$DEMO_DATASET_FILE" \
  --report "$ARTIFACT_DIR/dataset-validation.json"
```

## Authorized sequence

```bash
./deploy/scripts/backup_db.sh --output "$DEMO_BACKUP_DIR"
./deploy/scripts/update_demo_stack.sh --ref "$APPROVED_SHA"

< "$DEMO_DATASET_FILE" docker compose \
  --project-name newscast_navigator_demo \
  --env-file deploy/env/demo.env \
  -f deploy/compose.demo.yaml exec -T backend \
  python scripts/import_demo_dataset.py --input -

./deploy/scripts/smoke.sh --compose-file deploy/compose.demo.yaml
```

Проверяются unauthenticated `401`, отсутствие default credentials, authenticated
story read, обе desktop resolutions, CaptionPanels latest scenario и redaction
evidence. Dataset, screenshots, credentials и runtime `.env` не коммитятся.

Локальный clean rehearsal:

```bash
./deploy/scripts/rehearse_clean_deploy.sh \
  --project-name nn-product-reset-eval-final \
  --artifacts artifacts/product-reset/CP7/ops
```

Инициатор и разработчик: Павел Курзыкин.
© 2026 Павел Курзыкин. Все права защищены.
