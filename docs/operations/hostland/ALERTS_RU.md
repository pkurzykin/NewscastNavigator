---
type: runbook
status: active
owner: operations
audience: operators, agents
reviewed: 2026-09-30
---

# Почтовые технические сигналы Hostland

На домашнем сервере `newscast` использует личный `crontab`: каждые две
минуты запускаются `home_pull_verify.sh --kind production` и
`home_monitor.py --config .../keys/alert-config.json`. Системный
`newscast-mail-monitor.timer` должен оставаться выключенным, пока активен
cron: одновременный запуск двух расписаний создаёт дубли. Перед изменением
расписания сверяйте фактическое состояние и получите разрешение на домашний
сервер. Сентябрьские результаты вынесены в
[отчёт](../../reports/2026-09-30-operations-baseline.md).

Это мониторинг **инфраструктуры**, а не внешняя рассылка внутренних
уведомлений пользователям NewscastNavigator. Он выполняется на домашнем
сервере, чтобы сообщить о недоступности VDS. Рабочие данные, строки
журналов, пароли и содержимое копий в письма не попадают.

## Что проверяется

- Раз в две минуты: HTTPS `ncastnav.ru/api/health` и главная страница `www`
  на адресе VDS `185.221.215.76`, с проверкой сертификата для домена.
  Письмо об отказе отправляется после двух последовательных неудач.
- Возраст последнего DB point, **проверенного и доставленного домой**:
  максимум 15 минут от создания на VDS и максимум 10 минут от домашней
  проверки. `home_pull_verify.sh` обновляет `monitor/latest-production.json`
  атомарно только после успешной проверки всей цепочки DB+full bundle.
- Срок HTTPS-сертификата: предупреждение за 30 дней. Истёкший/неверный
  сертификат делает HTTPS-проверку неуспешной.
- После включения автоматической очистки: результат её ежедневного прохода.
  Ошибка или отсутствие успешного прохода более 36 часов вызывают отдельный
  сигнал `retention`; повтор — не чаще раза в сутки, после восстановления
  приходит одно письмо. Успешные проходы писем не создают.

Об одном продолжающемся отказе повторное письмо приходит не чаще раза в час;
о сертификате — не чаще раза в сутки. После восстановления приходит одно
письмо. Если SMTP недоступен, состояние «письмо отправлено» не записывается,
следующий запуск повторит попытку. SMTP может принять письмо и оборвать
соединение до подтверждения — в редком случае письмо повторится.

## Почтовый отправитель

Для отправки выбран существующий Gmail-аккаунт владельца. Включить для него
двухэтапную аутентификацию и создать отдельный пароль приложения для домашнего
монитора. Google описывает этот способ в
[справке по паролям приложений](https://support.google.com/accounts/answer/185833?hl=ru).
Используется `smtp.gmail.com:587` с обязательным STARTTLS и проверкой
сертификата. Пароль аккаунта Google и пароль приложения **не передавать в чат**.
Пароль приложения вводится непосредственно на домашнем сервере. Он даёт
приложению доступ к личному Gmail-аккаунту; при подозрении на компрометацию
его следует отозвать в настройках Google и заменить в закрытом файле.

Приватный конфиг (mode `0600`, владелец `newscast`):
`/home/newscast/private-demo/hostland-backups/keys/alert-config.json`.
Поля: `smtp_host`, `smtp_port`, `smtp_user`, `from_addr`, `to_addr`,
`password_file`, `vds_ip`, `backup_marker`, `state_file`, `lock_file`.
Адрес получателя из согласованного решения хранится только в этом файле,
не в Git. Пароль приложения находится в отдельном файле mode `0600` в `keys/`.
В `smtp_user`/`from_addr` указывается один и тот же выбранный Gmail-адрес.
Отправитель не принимает незащищённый SMTP и не отправляет на список адресов.

Личный адрес отправителя и согласованный адрес получателя уже записаны только
в закрытый домашний конфиг; его владелец `newscast`, права `0600`. Пароль
приложения уже сохранён на домашнем сервере, тестовое письмо доставлено.
Для новой установки пароль создаётся в
[настройках аккаунта Google](https://myaccount.google.com/apppasswords)
после включения двухэтапной проверки и вводится на домашнем сервере от
`newscast` через скрытый терминальный запрос (не в чат и не в командной строке):

```bash
python3 - <<'PY'
from getpass import getpass
import os
from pathlib import Path

path = Path('/home/newscast/private-demo/hostland-backups/keys/gmail-app-password')
secret = getpass('Пароль приложения Gmail: ')
if len(''.join(secret.split())) < 16:
    raise SystemExit('Пароль приложения слишком короткий')
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(secret + '\n')
    stream.flush()
    os.fsync(stream.fileno())
print('Пароль сохранён в закрытом файле')
PY
```

Если файл уже существует, команда завершится ошибкой и не перезапишет его.

## Установка и включение

Скопировать `alert_mail.py`, `home_monitor.py`, `write_delivery_marker.py`
и обновлённый `home_pull_verify.sh` в
`/home/newscast/private-demo/hostland-backups/` с владельцем `newscast`
и правами `0700`. Создать `monitor/` mode `0700`. Установить
`mail-monitor.service` как `/etc/systemd/system/newscast-mail-monitor.service`,
`mail-monitor.timer` — как `/etc/systemd/system/newscast-mail-monitor.timer`,
затем `systemctl daemon-reload`. При действующем домашнем `cron` системный
таймер оставьте выключенным. До включения нового расписания проверьте
доступность HTTPS VDS и первой доставленной production DB-точки.
Дополнительная защита: служба завершится ошибкой, пока нет файла
`monitor/cutover-active` с владельцем `newscast`, правами `0600` и точным
содержимым `monitor-enabled` с завершающим переводом строки. Отсутствие
конфигурации тоже завершает службу ошибкой, а не скрытым пропуском запуска.

Скрипты размещают в домашнем каталоге `newscast`; unit-файлы —
в `/etc/systemd/system/`. Их нужно проверить через `systemd-analyze` и
оставить выключенными при работе `cron`.
Для повторной установки из сохранённых копий в `staged-systemd/`:

```bash
sudo install -o root -g root -m 0644 \
  /home/newscast/private-demo/hostland-backups/staged-systemd/newscast-mail-monitor.service \
  /etc/systemd/system/newscast-mail-monitor.service
sudo install -o root -g root -m 0644 \
  /home/newscast/private-demo/hostland-backups/staged-systemd/newscast-mail-monitor.timer \
  /etc/systemd/system/newscast-mail-monitor.timer
sudo systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/newscast-mail-monitor.service \
  /etc/systemd/system/newscast-mail-monitor.timer
```

Ожидаемое состояние при выбранном домашнем `cron`:
`systemctl is-enabled newscast-mail-monitor.timer` — `disabled`, а
`systemctl is-active` — `inactive`.

После записи пароля выполнить от `newscast`:

```bash
python3 /home/newscast/private-demo/hostland-backups/alert_mail.py \
  --config /home/newscast/private-demo/hostland-backups/keys/alert-config.json --test
```

`ALERT_EMAIL_ACCEPTED_BY_SMTP=true` означает, что SMTP принял тестовое
письмо; адресат отдельно подтверждает его получение (включая «Спам»).
Для диагностики текущего режима:
`crontab -l` от `newscast` и
`journalctl -t newscast-home-pull -t newscast-mail-monitor`.
Если администратор позже переведёт расписание на подготовленные systemd units,
он должен сначала убрать обе записи из `crontab`, затем включить
`home-pull.timer` и `newscast-mail-monitor.timer` и проверить их запуск.
Порядок автоматической очистки и её отдельного ежедневного задания описан в
`RETENTION_RU.md`. Контроль `retention` включается закрытым файлом
`monitor/retention-active` только после проверенного первого прохода.

Предел схемы: при отключении самого домашнего сервера он не сможет отправить
письмо. Для обнаружения такого отказа нужен внешний мониторинг или второй
независимый отправитель; это отдельный этап.

## Если сигнализируется отказ

Проверьте статус сайта и сертификата, затем возраст последней **проверенной
дома** DB-точки и результат pull. При повторении сдвига часов сравните
независимые часы, `chronyc tracking`, RTC и `backup.timer`; затем проверьте
новую доставленную DB-точку. Не отключайте монитор и не увеличивайте порог,
пока копия устарела. При продолжающемся сдвиге времени или нестабильном SSH
передайте провайдеру время сбоя и показания часов. Секреты и содержимое
рабочих данных в письмо или отчёт не включайте.

© 2026 Павел Курзыкин. Все права защищены.
