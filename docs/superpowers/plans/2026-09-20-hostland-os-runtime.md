# Hostland: ОС и Docker — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Execute sequentially; record live evidence, no application deployment.

**Goal:** Подготовить ОС и контейнерный runtime, проверить загрузку и SSH после reboot.
**Architecture:** Сохраняем Ubuntu 26.04 LTS, key-only SSH и UFW; обновляем штатные пакеты, ограничиваем логи, добавляем swap, ставим Docker из официального APT.
**Tech Stack:** Ubuntu, systemd, OpenSSH, UFW, Docker Engine + Compose.
**Spec:** ../specs/2026-09-20-hostland-production-migration-design.md, C4/C5.

Авторизация: владелец прямо поручил «делай следующий этап» после перечисления
обновлений ОС, памяти/логов, контрольной перезагрузки и Docker. Этот документ
конкретизирует разрешённый этап; повторное подтверждение тех же действий не нужно.
Исходная ветка codex/hostland-migration-design, commit 41fc5c8.
Статус: выполнено 20 сентября 2026 года; условные rollback-ветки не понадобились.
Отчёт: ../specs/2026-09-20-hostland-os-runtime-result.md.

## Границы и файлы

- Mac CREATE `~/.ssh/newscast_hostland_known_hosts`, `~/.ssh/newscast_hostland.conf`; существующий общий config и ключ KEEP.
- VDS CREATE root-only `/root/newscast-os-backup-XXXXXXXX/`: копии конфигурации и пакетный inventory, не полная копия приложения.
- ADAPT пакеты через apt upgrade; не делать autoremove, dist-upgrade или смену дистрибутива.
- ADAPT `/etc/default/grub.d/kdump-tools.cfg`: снять резерв crashkernel, поскольку USE_KDUMP=0. `/etc/default/grub` KEEP; `/boot/grub/grub.cfg` генерируется update-grub.
- CREATE `/swapfile` 2 GiB 0600; ADAPT `/etc/fstab` одной записью; CREATE `/etc/sysctl.d/60-newscast-memory.conf`, vm.swappiness=10.
- CREATE `/etc/systemd/journald.conf.d/60-newscast-limits.conf`: SystemMaxUse=256M, SystemKeepFree=1G, RuntimeMaxUse=64M, MaxRetentionSec=14day.
- CREATE `/etc/apt/apt.conf.d/99-newscast-updates`: automatic reboot=false; periodic security install остаётся включён.
- CREATE `/etc/needrestart/conf.d/99-newscast.conf`: restart='l'. Это управляет needrestart, не отменяет рестарты из maintainer scripts пакетов.
- CREATE `/etc/apt/keyrings/docker.asc`, `/etc/apt/sources.list.d/docker.sources`; scoped Signed-By, официальный stable repository для resolute/amd64.
- CREATE `/etc/docker/daemon.json`: local log-driver, max-size=10m, max-file=3, live-restore=true. Docker API только Unix socket, группу docker пользователям не выдавать.
- ADAPT только документы плана, inventory и PROGRESS в Git. Приложение/БД/DNS/домашний сервер KEEP.

## Task 1: Постоянный доступ и backup

- [x] Проверить fingerprint host и client public key; при несовпадении остановиться.
- [x] Скопировать проверенный known_hosts в отдельный постоянный файл 0600; создать standalone config 0600 для alias newscast-hostland с HostName=185.221.215.76, User=newscast-admin, IdentityFile=~/.ssh/newscast_codex, IdentitiesOnly=yes, StrictHostKeyChecking=yes, UserKnownHostsFile=~/.ssh/newscast_hostland_known_hosts, ForwardAgent=no.
- [x] Проверить `ssh -F ~/.ssh/newscast_hostland.conf newscast-hostland 'sudo -n true'` без ControlMaster.
- [x] Создать root-only backup, сохранить fstab, grub configs/grubenv, SSH dropins, UFW, APT/needrestart/journald настройки; не выводить их целиком. Записать installed package versions и boot_id.

## Task 2: Обновления ОС и предсказуемые рестарты

- [x] apt-get update; симуляция upgrade: ожидается 55 upgraded, 0 removed, 2 phased deferred. При изменении перечня оценить diff до применения. GRUB debconf target проверен как /dev/vda, существующий диск.
- [x] `DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get -y -o Dpkg::Options::=--force-confold upgrade`; журнал в root-only backup. Не принуждать phased updates.
- [x] Явно установить `Unattended-Upgrade::Automatic-Reboot "false";`; сохранить daily security updates. Для needrestart установить `$nrconf{restart} = 'l';`.
- [x] Проверить dpkg --audit, apt effective settings, sshd -t, grub-script-check, grubenv и новое SSH-соединение.

Уточнение стратегии: unattended security updates могут перезапустить службу
через maintainer scripts даже при needrestart list-only. Гарантии «никаких
рестартов вне окна» нет; для строгого окна нужна отдельная политика ручной
установки и контроля задержки security fixes. Автоматический reboot запрещён.

## Task 3: Память и логи

- [x] Убедиться, что kdump отключён, backup существует. Заменить единственную известную строку crashkernel в kdump-tools.cfg комментарием; не редактировать grub.cfg вручную. `update-grub`, затем grub-script-check; убедиться, что linux boot lines больше не содержат crashkernel.
- [x] Убедиться, что /swapfile отсутствует и свободно >5 GiB. Создать 2 GiB через fallocate, chmod 0600, mkswap, swapon. Добавить ровно `/swapfile none swap sw 0 0` в fstab; `findmnt --verify --tab-file /etc/fstab`, swapon --show.
- [x] Установить vm.swappiness=10 и проверить фактическое sysctl.
- [x] Установить перечисленные лимиты journald; restart journald, проверить эффективный конфиг и отсутствие parse warnings. Старые логи вручную не удалять.

2 GiB swap — защитный резерв для малой VM, не обещание выдержать будущую
нагрузку. Проверка нагрузки приложения относится к следующему этапу.

## Task 4: Docker

- [x] Скачать официальный публичный ключ Docker по HTTPS; inspect fingerprint, создать signed-by source. apt update; выбрать версии из apt-cache policy, симулировать установку без удалений.
- [x] Установить конкретные выбранные версии docker-ce/docker-ce-cli/containerd.io/buildx/compose. Не запускать curl|sh.
- [x] Создать daemon.json с local logging {max-size:10m,max-file:3} и live-restore=true; `dockerd --validate --config-file=...`, restart docker.
- [x] Проверить docker version/info, compose version, systemd enablement, Unix socket permissions; Docker TCP API не слушает.
- [x] Загрузить hello-world, сохранить RepoDigest, выполнить `docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges <digest>`. Убедиться, что тестовый контейнер удалён; образ можно оставить как проверочный.
- [x] Повторить UFW + iptables/ip6tables, SSH и внешние проверки 22/80/443/2375/2376/5432/8000/8088. Docker published ports в этом этапе отсутствуют; это не проверка будущего deploy firewall.

## Task 5: Контрольная перезагрузка и приёмка

- [x] До reboot: свежий SSH+sudo, sshd -t, GRUB syntax/env, valid fstab, boot disk, достаточный диск, отсутствие dpkg failure и сохранённые настройки. Аварийная консоль уже проверена владельцем; root console password сохраняется.
- [x] Выполнить одну штатную перезагрузку; кратко ожидать с bounded probes, не менять host key при отказе проверки.
- [x] После reboot: boot_id изменился; key-only SSH+sudo; root/password deny; failed units=0; UFW active; Docker active/enabled; hello-world по сохранённому digest; NTP sync; swap active; crashkernel reserve=0; effective log/update settings.
- [x] При невозможности подключения после разумного окна диагностика через консоль владельца; никакой автоматической переустановки ОС.
- [x] Зафиксировать версии, RAM/disk и deferred updates в inventory/PROGRESS, локальный docs commit. Review результатов, не заявлять production-ready.

Rollback: локальные конфиги доступны в root-only backup; SSH профиль additive.
При ошибке Docker вернуть сохранённый daemon config/остановить новый пустой
runtime. При ошибке boot config вернуть kdump config и выполнить update-grub
до reboot. Пакетный rollback не считается гарантированным: при пакетной ошибке
остановиться и исправлять конкретную причину, сохраняя SSH и консоль.

Источники проверены 2026-09-20: Docker Ubuntu installation/local logging,
Ubuntu automatic updates и kernel crash dump (URL в стратегии/inventory).

© 2026 Павел Курзыкин. Все права защищены.
