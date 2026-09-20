# Hostland: первоначальный доступ и firewall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Получить проверенный постоянный административный доступ по ключу и закрыть лишние входящие соединения на VDS.

**Architecture:** Отдельный системный администратор `newscast-admin` с SSH-ключом владельца и sudo. SSH остаётся на 22; UFW фильтрует IPv4 и IPv6. Старое root-соединение сохраняется до проверки новых независимых подключений.

**Tech Stack:** Ubuntu 26.04 LTS, OpenSSH, sudo, UFW, systemd.

**Spec:** [Стратегия, C1–C3](../specs/2026-09-20-hostland-production-migration-design.md); [текущее обследование](../specs/2026-09-20-hostland-migration-inventory.md).

Статус: проект на утверждение. Никакие команды изменения из этого плана ещё не выполнены.
Это первый ограниченный checkpoint подготовки, а не готовность production.

## Global Constraints

- VDS: `185.221.215.76:22`; подтверждённый ED25519 host fingerprint: `SHA256:PZUa8qLnBx64kgFmDeIzEXDAOn+OYjvSQ7R2FV0KqsI`.
- Вся текущая база сохраняется; домен `ncastnav.ru` сохраняется; полные копии размещаются дома.
- Здесь не меняются DNS, домашний сервер, приложение, PostgreSQL, Docker, загрузочные параметры и данные.
- Нет push, PR, merge, reboot, dist-upgrade или установки production.
- Доступ к консоли Hostland должен оставаться работоспособным; пароль root для аварийной консоли не блокировать.
- Приватные ключи и production env не читать и не включать в Git. Все копии системных настроек остаются на VDS в root-only каталоге.
- Выполнять последовательно в текущей задаче; изменения SSH проверять новым TCP-соединением без ControlMaster.

## Review Focus

- Старый master маскирует потерю доступа: все приёмочные SSH-проверки используют `-S none -o ControlMaster=no`.
- Cloud-init перекрывает парольную политику: использовать ранний `00-newscast-hardening.conf` и проверять `sshd -T -C`.
- Sudo не работает при locked password: явно согласуется `NOPASSWD: ALL` для единственного администратора; ключ даёт полномочия root.
- Firewall отсекает SSH или IPv6: сначала разрешить 22, включить IPv6, затем проверить новое подключение и обе таблицы правил.
- Старый failed GRUB ошибочно принимается за повреждение: сначала повторить чтение/синтаксис, затем штатную службу; ничего не пересоздавать вслепую.

## Карта файлов и полномочий

| Где | Файл / объект | Действие |
|---|---|---|
| VDS | `/home/newscast-admin/.ssh/authorized_keys` | CREATE: один публичный ключ владельца |
| VDS | `/etc/passwd`, `/etc/group`, `/etc/shadow`, `/etc/gshadow` | ADAPT только штатным useradd; не читать shadow |
| VDS | `/etc/sudoers.d/newscast-admin` | CREATE: административные sudo-права |
| VDS | `/etc/ssh/sshd_config.d/00-newscast-hardening.conf` | CREATE: политика SSH |
| VDS | `/etc/ssh/sshd_config`, `50-cloud-init.conf` | KEEP; проверить приоритет |
| VDS | `/etc/default/ufw`, `/etc/ufw/*` | ADAPT штатными командами UFW |
| VDS | `/root/newscast-bootstrap-backup-<UTC timestamp>/` | CREATE: закрытые копии изменяемых настроек |
| VDS | `/boot/grub/grubenv` | ADAPT только через штатный запуск grub2-common при валидном файле |
| Mac | `/Users/pavelkurzykin/.ssh/newscast_codex.pub` | KEEP: публичный ключ, приватная часть остаётся на Mac |
| Git | этот план, inventory, `docs/product-reset/PROGRESS.md` | ADAPT: результаты checkpoint без секретов |

Существующий ключ проекта используется для начального доступа: fingerprint
`SHA256:qaDk8hAzYFYr5bnNhx+sTWm0kQ+3CtfBf3Ta9e7i0vk`.
Это повторное использование ключа, которым уже администрируется домашняя
установка. Отдельные ключи для автоматизации backup будут частью другого плана.
Пользователи приложения системный доступ не получают. Аккаунт `ubuntu` не удалять;
он не входит в разрешённые SSH-пользователи новой политики.

## Task 1: Подготовить восстановление и администратора

**Files:** home нового администратора; sudoers; root-only каталог копий.
**Interfaces:** публичный ключ с Mac → authorized_keys VDS; результат — новый SSH-вход и `sudo -n true`.

- [ ] Проверить pinned host key, живую root-сессию и доступ владельца к консоли; повторить `sshd -t`, `getent passwd newscast-admin`. Если аккаунт или целевой override уже появился, сначала обследовать изменение, не перезаписывать.
- [ ] С `umask 077` создать каталог копий через `mktemp -d /root/newscast-bootstrap-backup-XXXXXXXX`; записать путь в локальный журнал checkpoint. Скопировать туда `/etc/ssh/sshd_config`, `/etc/ssh/sshd_config.d`, `/etc/sudoers.d` с сохранением прав. Не выводить их целиком.
- [ ] Создать аккаунт без парольного SSH-доступа:

```sh
useradd --create-home --shell /bin/bash newscast-admin
install -d -m 0700 -o newscast-admin -g newscast-admin /home/newscast-admin/.ssh
```

- [ ] Передать только `.pub` через защищённый SSH stdin во временный файл, сверить fingerprint через `ssh-keygen -lf`, установить как authorized_keys с владельцем newscast-admin и правами 0600. Не копировать приватный ключ.
- [ ] Создать sudoers со следующим содержимым и правами root:root 0440; проверить `visudo -cf` до установки и `visudo -c` после:

```sudoers
newscast-admin ALL=(ALL:ALL) NOPASSWD: ALL
```

- [ ] В отдельном подключении с Mac, `-F /dev/null -S none -o ControlMaster=no -o BatchMode=yes -o IdentitiesOnly=yes -i /Users/pavelkurzykin/.ssh/newscast_codex`, pinned known_hosts и StrictHostKeyChecking=yes выполнить `id; sudo -n true`. Если не проходит — остановиться, root пока доступен.

## Task 2: Переключить SSH на проверенный ключ

**Files:** `/etc/ssh/sshd_config.d/00-newscast-hardening.conf`.
**Interfaces:** использует успешную Task 1; выдаёт работающий key-only SSH.

- [ ] Подготовить root:root 0644 файл с точным содержимым:

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
AllowUsers newscast-admin
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding local
PermitTunnel no
MaxAuthTries 3
```

Local forwarding оставлен для будущих административных проверок через SSH;
forwarded agent не нужен. Порт 22 и socket activation сохраняются.

- [ ] До reload выполнить `sshd -t` и `sshd -T -C user=newscast-admin,addr=46.138.246.66,host=client`. Сверить все параметры выше; дополнительно проверить context root. Текущий адрес клиента повторно взять из SSH_CONNECTION перед проверкой.
- [ ] При несовпадении удалить только новый override и остановиться. При успехе выполнить `systemctl reload ssh.service`, сохраняя первоначальную root-сессию.
- [ ] Повторить новый вход администратора без master и `sudo -n true`.
- [ ] Новая попытка root с тем же публичным ключом должна быть отклонена. Проверить, что сервер не предлагает password authentication: `PreferredAuthentications=password`, `PubkeyAuthentication=no`, `BatchMode=yes`; пароль не отправлять. Сохранить только диагностические строки методов аутентификации.
- [ ] Если новая сессия администратора не работает, через старую root-сессию убрать новый override, проверить `sshd -t`, reload и восстановленный вход. Не закрывать старую сессию до успеха.

## Task 3: Включить firewall и проверить независимый вход

**Files:** пакет ufw и его штатные конфиги. Docker ещё отсутствует.
**Interfaces:** SSH из Task 2 → доступный SSH после применения firewall.

- [ ] Проверить официальные источники APT, выполнить `apt-get update`, затем `apt-get -s install ufw`; проверить отсутствие неожиданных удалений и изменений SSH/загрузчика. При таких изменениях остановиться и пересмотреть конкретный пакетный diff.
- [ ] Выполнить `apt-get install ufw`. Скопировать исходные `/etc/default/ufw` и `/etc/ufw` в root-only каталог Task 1. Проверить `IPV6=yes` и отсутствие старых правил, требующих сохранения.
- [ ] Применить в таком порядке:

```sh
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH administration'
ufw --force enable
ufw status verbose
```

- [ ] В новом SSH-соединении без master выполнить `sudo -n true`, `sudo ufw status verbose`, `sudo iptables -S`, `sudo ip6tables -S`. Проверить разрешение SSH и политику входящего трафика IPv4/IPv6.
- [ ] С Mac проверить TCP/22, 80, 443, 5432, 8000, 8088 с короткими timeout. Принимается только 22; отказ остальных при отсутствии слушателей сам по себе не доказывает работу firewall, поэтому обязательна предыдущая проверка правил.
- [ ] Если новый SSH не проходит, через старую сессию выполнить `ufw disable` и повторить подключение; не сохранять непроверенную конфигурацию как принятую.

80/443 откроются при подготовке HTTPS. Внешний IPv6-тест сейчас невозможен:
у интерфейса нет global IPv6. При его выдаче требуется отдельный внешний тест.
После установки Docker firewall проверяется заново: опубликованные контейнерные
порты требуют отдельного контроля, правила UFW не считаются достаточными.

## Task 4: Уточнить GRUB и закрыть checkpoint

**Files:** штатный grubenv; документы checkpoint. Изменение загрузчика не входит.
**Interfaces:** управляемый сервер → доказательства, пригодные для следующего этапа.

- [ ] Повторить `grub-editenv /boot/grub/grubenv list` и `grub-script-check /boot/grub/grub.cfg`. При любой ошибке остановить эту задачу: не делать `grub-editenv create`, `grub-install` или reboot.
- [ ] Сохранить `cp -a /boot/grub/grubenv` в каталог Task 1, затем выполнить `systemctl restart grub2-common.service`. Успех: Result=success, recordfail снят, служба отсутствует в failed. One-shot inactive после успешного завершения допустим.
- [ ] При повторной ошибке сохранить короткое сообщение, не сбрасывать failed ради косметики. Подготовить диагностику провайдеру без отправки сообщения от имени пользователя.
- [ ] Повторить SSH вход и sudo без master, `sshd -t`, эффективную SSH-политику, listeners, UFW, systemctl failed. Ничего не объявлять проверенным после reboot: reboot ещё не выполнялся.
- [ ] Обновить inventory и PROGRESS; создать небольшой локальный docs-коммит после `git diff --check`. Реальные секреты и системные backup в Git не включать.
- [ ] Закрыть временную root-master-сессию. Новый рабочий путь — newscast-admin с ключом.

## Приёмка и следующий этап

Checkpoint принят только при независимом key-only SSH + sudo, запрете нового
root/password SSH, проверенных правилах IPv4/IPv6 и честно зафиксированном
результате GRUB. Root в аварийной консоли сохраняется.

Следующий план включает обновления ОС и политику рестартов, резерв crashkernel,
swap по измерениям, ограничение логов, контрольную перезагрузку, Docker и
синтетическую установку. Домашние полные backup и DNS/cutover получают свои
проверки и порядок восстановления. Этот checkpoint их не подменяет.

Источники для SSH-приоритетов и проверки конфигурации:
[Ubuntu OpenSSH](https://ubuntu.com/server/docs/how-to/security/openssh-server/).
Память crashkernel подтверждена live; справка:
[Ubuntu kernel crash dump](https://ubuntu.com/server/docs/how-to/software/kernel-crash-dump/).

© 2026 Павел Курзыкин. Все права защищены.
