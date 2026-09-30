---
type: historical
status: historical
owner: documentation-steward
audience: developers, agents
reviewed: 2026-09-30
---

> Архивный материал. Состояния и следующие шаги ниже относятся к дате исходного документа; текущую работу они не назначают. [Каталог архива](../../README_RU.md).

# Hostland: ОС и Docker — результаты второго этапа

Дата: 20 сентября 2026 года, около 19:47 UTC после контрольной перезагрузки.
Владелец разрешил следующий этап: ОС, память/логи, reboot и Docker.
[План](../plans/2026-09-20-hostland-os-runtime.md) конкретизирован до изменений.
Первый этап доступа/firewall сохранён; продуктовый код не менялся.

## Результат

| Область | Проверенное состояние |
|---|---|
| ОС | Ubuntu 26.04 LTS, kernel 7.0.0-31-generic |
| Обновления | 55 пакетов обновлено, без удалений; dpkg audit чист |
| RAM | MemTotal 3910 MiB вместо 3398 MiB |
| Crashkernel | Резерв 512 MiB снят; после reboot kexec_crash_size=0 |
| Swap | /swapfile 2 GiB, 0600, активен после reboot, swappiness=10 |
| Диск | 30 GiB, около 5.8 GiB занято и 23 GiB свободно |
| Docker Engine | 29.8.1 |
| Docker Compose | 5.5.1 |
| containerd / buildx | 2.3.5 / 0.37.1 |
| Runtime startup | docker и containerd active/enabled после reboot |
| Docker logging | local, max-size=10m, max-file=3; live-restore=true |
| Journald | SystemMaxUse=256M, SystemKeepFree=1G, RuntimeMaxUse=64M, retention 14day |
| SSH | Только newscast-admin по ключу; root/password отклонены после reboot |
| UFW | Active/enabled; INPUT/FORWARD DROP IPv4/IPv6, TCP22 разрешён |
| Службы | Failed units=0; GRUB Result=success; AppArmor active |
| Время | Etc/UTC, NTP synchronized |
| Обновления в фоне | Daily security updates включены; auto reboot явно false; needrestart list-only |

Docker установлен из `https://download.docker.com/linux/ubuntu`, suite resolute,
stable/amd64. Ключ получен по официальному HTTPS, fingerprint
`9DC858229FC7DD38854AE2D88D81803C0EBFCD88`; доверие ограничено Signed-By.
Установлены выбранные exact package versions, не convenience script.
Docker socket root:docker 0660; группа docker пуста, команды через sudo.
TCP API не включён. Автоматическое обновление пакетов Docker этим этапом
не настроено: сохранён Ubuntu security origin policy.

## Проверки

1. Backup конфигурации и пакетного списка до изменений сохранён в
   `/root/newscast-os-backup-8XwxBhpi/`, root-only. Это не полный application backup.
2. apt upgrade симулирован до применения; установка прошла без ошибок.
   GRUB target `/dev/vda` совпадает с диском VM. Изменённый kdump dropin
   не резервирует память при уже отключённом USE_KDUMP=0; update-grub
   и grub-script-check прошли.
3. Fstab: parse errors=0, errors=0. findmnt выдаёт предупреждение, что
   /swapfile — обычный файл; swap подтверждён `swapon --show` до и после reboot.
   Предупреждение о stale systemd config снято через daemon-reload.
4. SSH проверялся отдельными соединениями; host key неизменен. После reboot
   новый root-вход отклонён, password-only проба без пароля получила только
   publickey и отказ. Эффективный sshd config и синтаксис проверены.
5. Штатная перезагрузка выполнена один раз. Boot ID изменился:
   `4e4e8984-1862-4d93-a860-0ce10c160de2` →
   `f770df29-e4ca-4132-b25c-5e59e1c66072`.
6. Официальный hello-world выполнен до и после reboot по одному digest:
   `sha256:5e23090353324d887c48ad5e5c56d294eab81588df9605b07d1afe895f9cc8f8`.
   Ограничения: network none, read-only, cap-drop ALL, no-new-privileges.
   Оба запуска дали Hello from Docker; временные контейнеры удалены через --rm,
   образ оставлен для проверки, действующих/остановленных контейнеров нет.
7. Правила IPv4/IPv6 перепроверены после Docker и после reboot. С Mac TCP22
   открыт; TCP80/443/2375/2376/5432/8000/8088 дали timeout 3s.
   Внешний IPv6 тест невозможен без global IPv6; локальные правила проверены.
8. Проверены эффективные настройки journald, отсутствие parse warnings,
   APT auto reboot=false, security periodic=1 и синтаксис needrestart config.

## Постоянный вход с Mac

Созданы отдельные файлы 0600:

- `/Users/pavelkurzykin/.ssh/newscast_hostland.conf`;
- `/Users/pavelkurzykin/.ssh/newscast_hostland_known_hosts`.

Общий SSH config не менялся, приватный ключ не копировался. Рабочая команда:

```sh
ssh -F ~/.ssh/newscast_hostland.conf newscast-hostland
```

Профиль использует existing key `~/.ssh/newscast_codex`, StrictHostKeyChecking=yes,
отдельный known_hosts и отключённый multiplexing. Изменение ключа сервера
требует повторной независимой проверки; автоматически принимать его нельзя.

## Ограничения и следующий этап

- Два обновления 0.120 → 0.120.1 (`python3-software-properties` и
  `software-properties-common`) отложены Ubuntu phased updates; не форсировались.
- Установка security updates может перезапустить отдельную службу через
  maintainer script. List-only needrestart и запрет reboot этого не отменяют.
  Контроль ошибок обновлений и необходимых рестартов включить в мониторинг.
- Swap — резерв при пиках; вместимость будущей командной нагрузки не доказана.
- Публичных Docker ports нет. Firewall конкретного deploy проверяется при
  его установке: одного UFW для published ports недостаточно.
- Ротация настроена и effective config проверен; заполнение логов до лимита
  не имитировалось. Live restore включён, но сохранение работающего приложения
  при рестарте dockerd не проверялось — приложения на VDS ещё нет.
- Домашний сервер, реальные данные, DNS и продуктовый runtime не менялись.
  Полный backup/restore, HTTPS, синтетическая установка и migration rehearsal
  ещё обязательны. Production-ready не заявляется.
- Next: зафиксировать целевой релиз, подготовить Compose с неизменяемыми
  образами, HTTPS и синтетическим smoke; отдельно полный backup домой и
  проверяемое восстановление, затем перенос всей текущей БД.

Применялись live operational проверки; application pytest/build/browser
не запускались, поскольку изменения приложения отсутствуют. Документы
сохранены в отдельной ветке; push/PR/merge не выполнялись.

Источники:
- [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/).
- [Docker local logging](https://docs.docker.com/engine/logging/drivers/local/).
- [Ubuntu automatic updates](https://ubuntu.com/server/docs/how-to/software/automatic-updates/).
- [Ubuntu kernel crash dump](https://ubuntu.com/server/docs/how-to/software/kernel-crash-dump/).

© 2026 Павел Курзыкин. Все права защищены.
