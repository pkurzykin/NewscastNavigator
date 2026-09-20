# Hostland: синтетическая установка и полный backup — Implementation Plan

> Use superpowers:executing-plans sequentially. User explicitly requested this next stage. Record live checks; never print secrets.

**Goal:** Запустить прежний рабочий релиз на синтетических данных с закрытым HTTPS, доставить полный зашифрованный комплект домой и восстановить из него отдельную установку.
**Spec:** ../specs/2026-09-20-hostland-production-migration-design.md.
**Boundary:** никакого DNS cutover, переноса настоящей БД или изменения домашнего runtime. Продление TLS, регулярный production backup/monitoring и переход на новый релиз остаются отдельными проверками.

Зафиксированный source checkout: 67da38b8ad819ce3d17ba769b494731b8ecab936 (домашний runtime1.2.0). Используем фактические image IDs четырёх работающих контейнеров, экспортируя только образы. Теги не считаются immutable provenance; source/image byte equivalence не заявляется, image IDs проверяются после load.

## Файлы и объекты

- CREATE repo `deploy/hostland/rehearsal.compose.yaml`: только prebuilt image IDs, pull_policy never, loopback HTTP8088/HTTPS8443, volume isolated project, no build, production env guard.
- CREATE repo `deploy/hostland/rehearsal-tls.conf.template`: существующий gateway template + TLS443; точные proxy headers и Origin:null остаются.
- VDS CREATE `/opt/newscast-rehearsal/` root-only: compose, TLS, env, image manifest, source archive, verification scripts. Secrets генерируются на VDS; env/keys не выводить и не коммитить.
- VDS CREATE `/opt/newscast-restore-rehearsal/`: отдельная restore среда, другой project/volume и loopback8089/8444.
- VDS CREATE `/var/lib/newscast-backup/`: временный root-only snapshot с dump/images/config/instructions/manifest; только шифрованный результат экспортируется. Не более одного текущего экспортируемого комплекта; partial не заменяет текущий.
- Home CREATE `/home/newscast/private-demo/hostland-backups/` 0700: encrypted snapshots, tools, keys; существующие backup KEEP.
- Home age из подписанного Ubuntu deb через apt download и dpkg-deb -x под newscast, без sudo и системной установки. VDS age через официальный APT после simulation.
- Home CREATE отдельный age identity, public recipient, restricted-pull SSH key; приватные ключи не выводить/не переносить на VDS.
- VDS CREATE `newscast-backup`: locked password, SSH key с restrict + forced cat единственного завершённого encrypted файла. Нет sudo, Docker group или общего shell через SSH. ADAPT AllowUsers добавить этот аккаунт, проверить effective SSH до/после reload и старый admin login.
- Git ADAPT inventory/strategy/PROGRESS и results; реальных данных/секретов нет.

## Task 1 — Образы и закрытый TLS

- [x] Подтвердить source checkout clean и четыре image IDs; сохранить манифест.
- [x] Экспортировать docker save по IDs с дома и docker load на VDS через SSH stream; проверить IDs. Не копировать volumes/env.
- [x] Передать существующий TLS bundle через SSH stream без вывода ключа. Проверить SAN/ncastnav.ru/срок/соответствие публичных ключей; permissions0600 для privkey.
- [x] Подготовить compose и env со случайными DB/session секретами. Images задаются sha256 IDs, pull_policy never; сертификат/ключ read-only. Порты только127.0.0.1.

## Task 2 — Синтетическая установка и HTTPS проверки

- [x] `docker compose config --quiet`; сначала свежая db, затем run migrations/seed в ENVIRONMENT=development одноразовым контейнером. Отключить все synthetic users, задать случайный пароль astra через stdin, активировать только astra. Production backend стартует после этого с SEED_DEMO_DATA=false.
- [x] Поднять app --no-build --pull never --wait. Проверить health, schema, counts; версия API из образа.
- [x] HTTPS curl с --resolve на loopback, полная проверка действующего сертификата без --insecure; cookie Secure/HttpOnly, login/me/stories/DOCX/CaptionPanels origin-null по действующему контракту.
- [x] Browser через SSH tunnel на localhost: проверить отображение реального интерфейса. TLS hostname/chain и сохранение synthetic scenario проверить отдельно по HTTPS API; реальные DNS/system hosts не менять, предупреждения браузера не обходить.
- [x] Внешние8088/8443/DB/backend недоступны. Production domain обслуживает домашнюю площадку как прежде.

## Task 3 — Полный зашифрованный комплект дома

- [x] Подготовить age tools и identity на домашнем сервере; передать только public recipient на VDS.
- [x] Создать consistent pg_dump из синтетической БД. Добавить exact docker save всех IDs, полный runtime config/env/TLS, исходники точного source commit, инструкции восстановления/OS и манифест SHA256 для всех файлов.
- [x] Шифровать весь tar через age на home recipient; закрытые temp файлы, атомарная публикация ciphertext. Никакого plaintext env/private key в tool output или Git.
- [x] Настроить dedicated restricted-pull SSH key. Home забирает ciphertext во временный файл, сверяет digest и только потом переименовывает в новую точку. Не добавлять cron и не удалять старые backup до определения production schedule/retention.
- [x] Проверить forced-command restriction и свежий admin SSH. VDS не получает credentials, позволяющие удалить домашние snapshots.

## Task 4 — Restore drill

- [x] Дома расшифровать комплект в0700 temp, проверить полный manifest; corruption test на копии ciphertext должен отказать, исходник KEEP.
- [x] Доставить проверенный комплект в отдельный root-only restore path VDS по администраторскому SSH stream через Mac; age private key остаётся дома.
- [x] Проверить image IDs/load из backup archive без registry, запустить только свежую db в project nn-product-reset-eval-hostland-restore; существующий restore_db.sh KEEP с eval-prefix и empty-db guards.
- [x] Restore dump, сравнить количества всех public tables и schema до app start. Затем запустить app в отдельной среде и повторить HTTPS/auth/функциональные проверки.
- [x] Не удалять исходный synthetic stack до успешного результата; restore stack можно остановить после evidence, сохранить volume для диагностики. Настоящая домашняя БД не читается в этой репетиции.
- [ ] Записать размер/длительность/limitations, локальный commit, read-only review. Не объявлять production RPO15m, automated TLS renewal или полный cutover завершёнными.

© 2026 Павел Курзыкин. Все права защищены.

## Исполнительный журнал и решения

- Task1: source/image archive/TLS переданы; четыре IDs совпали. Отдельное согласие владельца на TLS private key и source archive получено после auto-review rejection.
- Task2: runtime started; nginx duplicate upstream воспроизведён, mount исправлен на default.conf.template, четыре health green.
- Ruling: browser проверяет видимый экран входа через HTTP localhost внутри SSH-туннеля, API отдельно проверяет HTTPS chain/hostname, cookie, save/DOCX/CaptionPanels. CUA не предоставляет scoped DNS override; предупреждения TLS не обходятся. Ограничение: полноценный browser login/editor на целевом HTTPS origin остаётся pre-cutover check.
- Ruling: операционный checkpoint проверяется live before/after и полным targeted smoke; исходники приложения не меняются, его полный suite не заменяет эти проверки.
- Harness corrections: block_type=zk и segment_uid=seg_UUID соответствуют контракту1.2.0; failed save освобождает lease в finally.
- CORS: ALLOW_NULL_CORS_ORIGIN сам по себе не добавляет origin; runtime CORS_ORIGINS должен содержать https://ncastnav.ru:PORT,null. Отрицательная проверка обнаружила отсутствие ACAO; конфигурация исправлена.

- Task3 complete: home encrypted snapshot219548184bytes, SHA256 verified; decrypt/manifest63s, tamper reject.
- Task4 functional complete: home→VDS16s, fresh restore+HTTPS smoke33s, all21tables counts/content digests match, guard rejects populated DB. Restore stack stopped; home plaintext removed.
