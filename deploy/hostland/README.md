# Hostland: закрытая репетиция

Этот каталог относится только к `nn-product-reset-eval-hostland` и отдельному `nn-product-reset-eval-hostland-restore`. Это не production deploy и не автоматическое резервирование.

- `rehearsal.compose.yaml` — prebuilt images по immutable ID, без build/pull; gateway только loopback8088/8443. Файл устанавливается как `/opt/newscast-rehearsal/compose.yaml`.
- `rehearsal-tls.conf.template` — TLS внутри gateway. Устанавливается как `gateway-tls.conf.template`; mount заменяет именно `/etc/nginx/templates/default.conf.template` исходного образа.
- `rehearsal_https_smoke.py` — реальная проверка цепочки/hostname TLS, cookie, auth, DOCX и CaptionPanels; optional `--save` меняет только synthetic scenario. Устанавливается как `https_smoke.py`.
- `db_fingerprint.py` — количества и сортированный digest всех строк каждой public table; сравнивать перед первым запуском восстановленного приложения, иначе sessions/timestamps закономерно изменятся. Digest — проверка эквивалентности, не механизм защиты от злоумышленника; целостность архива обеспечивает age и SHA256 manifest.
- `build_rehearsal_backup.sh` — разовый полный backup синтетической установки в `/var/lib/newscast-backup/`; кратко останавливает только её app services. Устанавливается как `build_full_backup.sh`. Прежний encrypted export заменяется атомарно, домашние snapshots не удаляются. Требует подготовленные recipient, image manifest, source archive, TLS, runtime.env и RESTORE.md; runtime secrets не находятся в Git.
- `pull_verify_rehearsal.sh SNAPSHOT_ID SHA256` — запускается дома, strict SSH host checking, проверка digest, age decrypt, manifest и tamper test. Создаёт private plaintext restore directory для последующей репетиции; по её завершении его надо удалить. Приватные age/SSH ключи остаются дома.

CORS для исходной установки: `https://ncastnav.ru:8443,null`; restore: `https://ncastnav.ru:8444,null`. `ALLOW_NULL_CORS_ORIGIN=true` разрешает production validation, но сам по себе не добавляет `null` в allowlist. `SEED_DEMO_DATA=false`, secure cookie обязательны.

Восстановление использует существующий `deploy/scripts/restore_db.sh` с ограничением eval project и пустой БД. Полные инструкции и выбранные OS configs входят внутрь encrypted backup. Конфигурации SSH/fstab нельзя слепо накатывать на иной сервер.

Operational inventory: все файлы этого каталога CREATE (отдельный временный rehearsal path); `deploy/compose.demo.yaml`, gateway image и `deploy/scripts/restore_db.sh` KEEP. Canonical production deploy, renewal, timers, retention и alerts ещё предстоит ADAPT перед cutover. Удалённых legacy-файлов нет.

© 2026 Павел Курзыкин. Все права защищены.
