---
type: runbook
status: active
owner: operations
audience: operators, agents
reviewed: 2026-09-30
---

# Hostland: production и закрытая репетиция

Начните с [карты задач Hostland](README_RU.md). Перед применением сверяйте
installed SHA, схему, фактические копии и разрешённое окно работ.

Файлы `rehearsal.*`, `build_rehearsal_backup.sh` и
`pull_verify_rehearsal.sh` относятся только к синтетическим
`nn-product-reset-eval-hostland` и `nn-product-reset-eval-hostland-restore`.
Production deploy, backup, restore и мониторинг имеют отдельные файлы в
`deploy/hostland/` (см. [каталог конфигураций](../../../deploy/README.md)). Перечисленные ниже имена файлов
относятся к этому каталогу кода. Текущие маршруты — в
[PROJECT_STATE_RU.md](../../PROJECT_STATE_RU.md), датированные свидетельства —
в [отчёте](../../reports/2026-09-30-operations-baseline.md). Перед действиями
сверяйте runtime заново.

- `rehearsal.compose.yaml` — prebuilt images по immutable ID, без build/pull; gateway только loopback8088/8443. Файл устанавливается как `/opt/newscast-rehearsal/compose.yaml`.
- `rehearsal-tls.conf.template` — TLS внутри gateway. Устанавливается как `gateway-tls.conf.template`; mount заменяет именно `/etc/nginx/templates/default.conf.template` исходного образа.
- `rehearsal_https_smoke.py` — реальная проверка цепочки/hostname TLS, cookie, auth, DOCX и CaptionPanels; optional `--save` меняет только synthetic scenario. Устанавливается как `https_smoke.py`.
- `db_fingerprint.py` — количества и сортированный digest всех строк каждой public table; сравнивать перед первым запуском восстановленного приложения, иначе sessions/timestamps закономерно изменятся. Digest — проверка эквивалентности, не механизм защиты от злоумышленника; целостность архива обеспечивает age и SHA256 manifest.
- `build_rehearsal_backup.sh` — разовый полный backup синтетической установки в `/var/lib/newscast-backup/`; кратко останавливает только её app services. Устанавливается как `build_full_backup.sh`. Прежний encrypted export заменяется атомарно, домашние snapshots не удаляются. Требует подготовленные recipient, image manifest, source archive, TLS, runtime.env и RESTORE.md; runtime secrets не находятся в Git.
- `pull_verify_rehearsal.sh SNAPSHOT_ID SHA256` — запускается дома, strict SSH host checking, проверка digest, age decrypt, manifest и tamper test. Создаёт private plaintext restore directory для последующей репетиции; по её завершении его надо удалить. Приватные age/SSH ключи остаются дома.

CORS для исходной установки: `https://ncastnav.ru:8443,null`; restore: `https://ncastnav.ru:8444,null`. `ALLOW_NULL_CORS_ORIGIN=true` разрешает production validation, но сам по себе не добавляет `null` в allowlist. `SEED_DEMO_DATA=false`, secure cookie обязательны.

Восстановление использует существующий `deploy/scripts/restore_db.sh` с ограничением eval project и пустой БД. Полные инструкции и выбранные OS configs входят внутрь encrypted backup. Конфигурации SSH/fstab нельзя слепо накатывать на иной сервер.

Production работает на Hostland; последний подтверждённый снимок и его
ограничения — в [точке продолжения](../../PROJECT_STATE_RU.md). Перед новой
операцией проверьте VDS и домашний монитор фактически. Датированная история
переезда и репетиций — в [отчёте](../../reports/2026-09-30-operations-baseline.md).

[Порядок нового выпуска](../RELEASE_WORKFLOW_RU.md) связывает
приёмку дома, точный кандидат, явное разрешение и проверку результата VDS.
Куратор релиза проверяет готовность и evidence, deploy выполняет разрешённый
исполнитель.

Production runtime и backup/restore описаны в [RESTORE_PRODUCTION.md](RESTORE_PRODUCTION.md).
Аварийный путь без домашнего сервера и изолированная репетиция — в
[HOME_LOSS_RECOVERY_RU.md](HOME_LOSS_RECOVERY_RU.md).
Защищённая запасная копия домашнего age identity на USB и её проверка —
в [USB_RECOVERY_RU.md](USB_RECOVERY_RU.md).
Домашний почтовый мониторинг и границы его включения — в [ALERTS_RU.md](ALERTS_RU.md).
Правило хранения, защитные проверки и порядок автоматической очистки — в
[RETENTION_RU.md](RETENTION_RU.md).

© 2026 Павел Курзыкин. Все права защищены.
