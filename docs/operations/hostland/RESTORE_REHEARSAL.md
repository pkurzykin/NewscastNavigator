---
type: runbook
status: active
owner: operations
audience: operators, agents
reviewed: 2026-09-30
---

# Изолированная репетиция восстановления Hostland

Применяйте только к синтетическому полному архиву на совместимом
amd64 Docker-хосте с PostgreSQL 16. Это не копия рабочей БД и не
инструкция по открытию production. Нужны разрешение на выбранный
изолированный хост и доверенная копия age identity, которая не входит
в архив. `runtime/image-manifest.json` задаёт точные image IDs и commit.
Если manifest и архив относятся к разным релизам, остановитесь.

1. Проверьте записанный администратором digest зашифрованного архива.
   Расшифруйте его в новый private-каталог mode `0700`, затем проверьте
   `SHA256SUMS` для каждого файла. Не печатайте `runtime.env`, ключи,
   токены. Не распаковывайте недоверенный архив от root без проверки путей
   и типов членов.
2. Подготовьте совместимый Ubuntu/Docker runtime по записанному
   эксплуатационному снимку. `os/config.tar` и перечень пакетов служат
   справкой: сетевые интерфейсы, fstab/UUID, SSH-пользователи и host keys
   зависят от новой машины. Создайте новые SSH host keys и доступ
   администратора; они не включены в архив.
3. Выполните `docker load -i images.tar`; сверяйте все четыре image ID с
   `runtime/image-manifest.json`. Приложению registry не требуется,
   но установка OS/Docker может требовать официальные репозитории или
   отдельный пакетный кэш.
4. Разместите runtime в `/opt/newscast-restore-rehearsal` с mode `0700`,
   приватные key/env — `0600`. Только для изолированного env задайте
   `HTTP_PORT=8089`, `HTTPS_PORT=8444` и
   `CORS_ORIGINS=https://ncastnav.ru:8444,null`; учётные данные БД должны
   соответствовать восстановленному runtime. Compose project —
   `nn-product-reset-eval-hostland-restore` с новым томом.
5. Запустите только DB. Выполните `runtime/restore_db.sh` с
   `--project-name nn-product-reset-eval-hostland-restore`,
   `--compose-file .../compose.yaml`, `--env-file .../runtime.env` и
   `--input .../database.dump`. Скрипт требует checksum и пустую public
   schema. Backend до восстановления не запускайте.
6. **До** старта backend/authentication сравните результат
   `db_fingerprint.py` с `db-fingerprint.json`: число строк и digest
   содержимого должны совпасть. Затем запустите остальные службы с
   `--no-build --pull never --wait` и выполните `https_smoke.py`
   с restore runtime и портом `8444`. Он проверяет TLS chain/hostname,
   login, cookie, DOCX и CaptionPanels; `--save` меняет синтетические
   данные и требует сознательного выбора.
7. Проверьте, что все порты приложения остались на loopback и публичный DNS
   не менялся. По окончании остановите тестовый проект, удалите открытый
   временный каталог, сохраните защищённый исходный архив и отчёт без
   секретов. При ошибке fingerprint, TLS, cleanup или неожиданной
   публикации портов остановите репетицию и разберите состояние до повтора
   в новом пустом проекте.

Архив включает синтетическую PostgreSQL БД, четыре application image,
source archive, runtime settings, TLS private key, тестовую учётную запись,
выбранные OS configs, пакетный inventory и manifest. Он не включает
внешние носители, домашние приватные backup-ключи, VDS SSH-ключи,
пакеты `.deb` и образ всего диска. Исторические version, SHA и срок
сертификата — в [отчёте](../../reports/2026-09-30-operations-baseline.md);
перед новой репетицией проверьте их заново.

© 2026 Павел Курзыкин. Все права защищены.
