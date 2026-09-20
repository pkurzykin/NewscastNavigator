# Hostland: результат закрытой репетиции и полного backup

Проверено20.09.2026. Выполнено по последовательным разрешениям владельца; отдельное точное разрешение на передачу TLS private key и source archive получено после отказа автоматической проверки. Реальная домашняя БД и DNS не переносились.

## Развёртывание и проверки

На VDS185.221.215.76 запущен project `nn-product-reset-eval-hostland`: релиз1.2.0, source archive67da38b8ad819ce3d17ba769b494731b8ecab936. Перенесены четыре фактических работающих домашних Docker images по immutable IDs; после load все IDs совпали. Эквивалентность исходников и байтов образов не заявляется: исходные images не имеют revision OCI labels.

| Сервис | Проверенный image ID |
|---|---|
| db | sha256:97ff59a4e30e08d1c11bdcd9455e7832368c0572b576c9092cde2df4ae5552a3 |
| backend | sha256:6fb10f8f78fdb596891c53210aca112528d18e0b8f31d0964f5d003b20464c58 |
| frontend | sha256:5bff2c50c72cea8ad2574e638a21770c464008f15c26f5eee334f25e97810b6e |
| gateway | sha256:92bbb06df5dee3e62e41685c90150128bf10eedd4d62bdcb30849116635a4220 |

- Fresh PostgreSQL16, Alembic20260806_0004; только synthetic seed:35stories (30active),8users. Все seed accounts отключены, только astra активирован после назначения случайного пароля. DB/session credentials случайные, файлы0600, каталог0700.
- Все четыре сервиса healthy. Публикация только127.0.0.1:8088/8443; DB/backend наружу не публикуются. Внешние80/443/5432/8000/8088/8443 closed-or-filtered,22open.
- HTTPS chain/hostname проверены без insecure; TLS certificate/private-key match и SANncastnav.ru подтверждены. Existing GlobalSign certificate действует до2026-11-08.
- End-to-end HTTPS API: login, Secure/HttpOnly cookie, me, stories, stable seg_UUID scenario save/readback, DOCX ZIP/content type/attachment/no-store, CaptionPanels bearer с Origin:null и ACAO:null. DOCX37205bytes после двух synthetic save.
- Browser через локальный SSH HTTP-туннель: реальный экран входа и footerv1.2.0 визуально проверены. Полный browser login/editor на целевом HTTPS origin не проверен; TLS и save проверены отдельным HTTPS API smoke. Browser security warnings не обходились, system hosts/DNS не менялись.
- Найдено и исправлено: mount TLS template должен заменять `default.conf.template`, иначе duplicate upstream; CORS_ORIGINS должен явно включать `null` вместе с ALLOW_NULL_CORS_ORIGIN=true. Ошибки тестового запроса (zk, seg_UUID) исправлены в harness, приложение не менялось.

## Полная копия дома

`/home/newscast/private-demo/hostland-backups/snapshots/20260920T204758Z-synthetic.tar.age`

- Размер219548184bytes (~219.55MB /209.38MiB).
- SHA256: `3bfaadd16f879f8b28bcd51ce099a8533de57f4315082a62a737089760865a8f`.
- Состав: согласованный custom pg_dump всей synthetic DB; все4Docker images; source archive; compose/nginx/runtime.env/TLS; smoke credential; инструкции и проверки; выбранные OS configs, inventory пакетов; SHA256SUMS всех файлов.
- Перед снимком кратко остановлены только synthetic backend/frontend/gateway; pg_dump и fingerprint сняты без app writes. Домашний production не останавливался.
- age1.2.1 на VDS из Ubuntu APT; дома user-local age1.1.1 из официального Ubuntu deb. Совместимость decrypt проверена.
- Домашний каталог0700; private age identity и pull SSH key0600; snapshot0600. Age private identity никогда не передавался на VDS.
- `newscast-backup` на VDS: без sudo/docker; ключ с restrict и fixed forced command читает только готовый ciphertext. Произвольная SSH-команда вернула тот же digest архива; forwarding получил administratively prohibited. Admin SSH/sudo после изменения AllowUsers прошёл. Пароль/root SSH остаются выключены.
- Дом сам скачал архив по pinned SSH host key, сверил digest, расшифровал, проверил пути/типы tar members и все SHA256SUMS. Время transfer/decrypt/verify63s. Повреждение одного байта ciphertext привело к отказу age.
- Домашних cron/timers/retention deletion нет. Старые копии не удалялись. Это разовая synthetic rehearsal, не production backup и не подтверждение RPO15m.

## Реальное восстановление

Проверенный комплект доставлен из домашнего хранилища на VDS за16s; восстановление не использовало исходный VDS dump напрямую. Separate project `nn-product-reset-eval-hostland-restore`, fresh volume; loopback8089/8444.

1. Manifest повторно проверен на VDS.
2. Все4образа загружены из backup archive и проверены по IDs, без registry.
3. Сначала только fresh DB; canonical `restore_db.sh` восстановил dump в пустую public schema.
4. До запуска backend совпали counts и sorted content digests всех21public tables, включая users/history/sessions. В частности35stories/35scenarios/8users/2scenario_rows/3scenario_revisions.
5. Все4сервиса healthy; HTTPS login/me/stories/DOCX/CaptionPanels прошли на8444.
6. Restore+startup+smoke33s. Это время на уже подготовленном VDS, не полный RTO восстановления нового сервера.
7. Повторный restore в populated DB отвергнут с exit2 до записи.

Restore stack после проверки остановлен, volume сохранён. Исходная closed synthetic среда остаётся для следующего этапа. Домашний временный plaintext удалён; encrypted snapshot и keys сохранены. Публичный production `/api/health` healthy; DNS A46.138.246.66, AAAA отсутствует, NSns1/ns2.reg.ru. В REG.RU read-only найдены A@ и Awww на домашний IP; авторитетный DNS подтверждает TTL21600s (6h) обеих записей; записей не меняли.

## Остаток до production

- Зафиксировать релиз после работы другого агента и проверить его отдельно, если он отличается от1.2.0.
- Настроить выпуск/автоматическое продление TLS, контроль срока и alert; текущий cert даёт время, но не готовую автоматизацию.
- Согласовать и включить production backup schedule/retention/alerts; обеспечить вторую защищённую копию age recovery identity вне домашнего сервера.
- Подготовить exact cutover/rollback plan; после разрешения — финальный полный backup настоящей БД, transfer/restore/check, DNS switch обоих используемых имён, public smoke и browser login/editor/CaptionPanels client.
- Полный комплект приложения не является whole-disk image. OS/Docker .deb не включены; подготовка чистой ОС требует официальных репозиториев. Сырые внешние media не копируются. Фактическая нагрузочная вместимость ещё не измерена.

Операционный scope не меняет код приложения; полный backend/frontend suite не запускался. Проверены реальные runtime, TLS/API/browser login page, negative access/tamper/restore guards, full backup/restore, shell/Python syntax и diff. Нет push/PR/merge/DNS cutover.

©2026 Павел Курзыкин. Все права защищены.

Финальное состояние: original rehearsal4healthy, restore4exited, ssh/ufw/dockeractive, failed units0, VDS22GiBfree. Временные plaintext snapshot/bundle каталоги убраны и дома, и на VDS; runtime и volumes сохранены. Browser smoke tab и временный tunnel закрыты; пользовательская REG.RU tab сохранена.

Fresh read-only review: Critical0/Important0; единственный whitespace defect исправлен и проверен. Reviewer проверял repo/evidence, не повторял live server actions.
