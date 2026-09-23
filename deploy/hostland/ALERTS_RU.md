# Почтовые технические сигналы Hostland

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
затем `systemctl daemon-reload`. **Не включать таймер до публичного CP6**:
порт 443 VDS сейчас закрыт, production-копий ещё нет, поэтому монитор
закономерно сообщил бы об отказе.
Дополнительная защита: служба завершится ошибкой, пока нет файла
`monitor/cutover-active` с владельцем `newscast`, правами `0600` и точным
содержимым `monitor-enabled` с завершающим переводом строки. Отсутствие
конфигурации тоже завершает службу ошибкой, а не скрытым пропуском запуска.

Скрипты размещены в домашнем каталоге `newscast`; unit-файлы установлены
в `/etc/systemd/system/`, проверены `systemd-analyze` и остаются выключенными.
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

До публичного CP6 `systemctl is-enabled newscast-mail-monitor.timer` должен
показывать `disabled`, а `systemctl is-active` — `inactive`.

После записи пароля выполнить от `newscast`:

```bash
python3 /home/newscast/private-demo/hostland-backups/alert_mail.py \
  --config /home/newscast/private-demo/hostland-backups/keys/alert-config.json --test
```

`ALERT_EMAIL_ACCEPTED_BY_SMTP=true` означает, что SMTP принял тестовое
письмо; адресат отдельно подтверждает его получение (включая «Спам»).
При первоначальной настройке это подтверждение получено.
При cutover, после первого проверенного production DB point дома и открытия
HTTPS VDS, создать файл включения указанного формата и включить
`newscast-mail-monitor.timer`. Проверить один штатный
запуск, затем контролируемый сбой в изолированном тесте и восстановление.
Для диагностики: `journalctl -u newscast-mail-monitor.service` и
`systemctl list-timers newscast-mail-monitor.timer`. Автоудаление копий
эта служба не выполняет.

Предел схемы: при отключении самого домашнего сервера он не сможет отправить
письмо. Для обнаружения такого отказа нужен внешний мониторинг или второй
независимый отправитель; это отдельный этап.
