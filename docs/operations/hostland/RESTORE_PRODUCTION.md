---
type: runbook
status: active
owner: operations
audience: operators, agents
reviewed: 2026-09-30
---

# Восстановление Hostland production

Применяйте только к утверждённому инциденту или окну переноса в **пустую**
цель. Скрипт `deploy/hostland/restore_production.sh` изменяет БД и никогда
не запускается таймером. Перед действием нужен отдельный план с точным
источником, целевым хостом, схемой, оценкой потери записей, ответственными и
разрешением владельца. Сентябрьский cutover с работающего дома был другим
событием; его результаты и исходный путь в Git `09d4c52` приведены в
[отчёте](../../reports/2026-09-30-operations-baseline.md).

Если дом недоступен, начните с [аварийного выбора источника](HOME_LOSS_RECOVERY_RU.md)
и [защищённого USB identity](USB_RECOVERY_RU.md). Не переносите открытый age
identity на VDS. Выбранную зашифрованную точку проверьте на доверенной машине
до переноса открытого дампа. Парольную фразу храните отдельно от USB;
никаких ключей, `.env`, дампов и рабочих данных в Git, чат и журналы.

## Подготовка источника и пустой цели

1. Сверьте exact approved commit, image manifest и `source_commit` пары
   DB/full backup. Проверьте ciphertext SHA-256, age-расшифровку, состав
   полного архива, `SHA256SUMS` и пригодность схемы. Отметьте время DB-точки
   и возможную потерю записей после неё.
2. Подготовьте `/opt/newscast-production` из проверенного full bundle,
   сохранив `tls/active` и `tls/versions/initial`, загрузив `images.tar`
   и выполнив `verify_release.sh`. Runtime остаётся root-only, gateway —
   на loopback/maintenance, application service остановлен. OS configs,
   SSH и fstab из архива не накатывают слепо на другую машину.
3. Перенесите выбранные `database.dump`, строгий
   `database.dump.sha256` и `source-fingerprint.json` через pinned SSH в
   root-owned `/opt/newscast-restore-staging-<id>`. Открытые файлы не
   размещайте на Mac. Проверьте, что целевой PostgreSQL volume новый и
   public schema пуста. Скрипт сам откажет при работающем production service
   или других application containers.

## Восстановление и результат

После явного разрешения оператор задаёт `RESTORE_STAGING` равным точному
утверждённому пути staging и запускает на целевой машине от root:

```bash
: "${RESTORE_STAGING:?Укажите утверждённый путь staging}"
/opt/newscast-production/restore_production.sh --staging-dir "$RESTORE_STAGING"
```

Скрипт проверяет релиз, checksum и пустую схему, восстанавливает dump,
сравнивает `db_fingerprint.py` с исходным fingerprint, допускает исходную
Alembic `20260806_0004` или `20260914_0005` и приводит её к
`20260914_0005`. Ожидаемый вывод:
`PRODUCTION_RESTORE_VERIFIED=true SCHEMA=20260914_0005 APPLICATION_NOT_STARTED=true`.
Он **не запускает приложение**. Несовпадение fingerprint, схемы или
частичный restore — остановка: не повторяйте команду поверх такой БД,
создайте новую пустую цель после разбора причины.

Дальнейшие запуск, разрешённые smoke-проверки, копия на VDS и доставка домой,
публичное открытие, DNS и пользовательский контроль входят только в
утверждённый incident-план. До открытия проверьте healthy, TLS/health и
проверенную новую точку копии. На реальной рабочей БД не создавайте probe
сюжет без отдельно согласованной disposable учётной записи и сценария;
`--write-test` меняет данные. После проверки удалите открытый staging.
Если на цели после снимка появились рабочие правки, возвращение к старой
БД или DNS без их согласования запрещено. Старый домашний backend над
устаревшим томом не включайте.

© 2026 Павел Курзыкин. Все права защищены.
