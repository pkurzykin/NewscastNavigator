# Тексты лицензий сторонних компонентов

Этот каталог содержит неизменённые тексты лицензий, проверенные для
конкретных пакетов. Он **не является полным комплектом уведомлений для
передачи сервера или Docker-образа**: состав такого комплекта определяется
по фактическому релизу.

| Компонент | Версия при проверке | Текст и источник |
|---|---|---|
| `psycopg`, `psycopg-binary` | `3.3.4` | [`psycopg-LGPL-3.0.txt`](psycopg-LGPL-3.0.txt), точная копия `LICENSE.txt` из обоих установленных дистрибутивов; SHA-256 `e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118` |
| Условия GPL-3.0, включённые в LGPL-3.0 | `3.0` | [`GPL-3.0.txt`](GPL-3.0.txt), текст с [официального сайта GNU](https://www.gnu.org/licenses/gpl-3.0.txt); SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` |
| `Onest` | файл, закреплённый в репозитории | [`frontend/public/fonts/onest/OFL.txt`](../frontend/public/fonts/onest/OFL.txt); SHA-256 `071195d8806e226faeee60259c28ca67b458227af5195a73f5cfcab06e3003bc` |

`psycopg` и `psycopg-binary`: Copyright (C) 2020 The Psycopg Team, согласно
metadata установленных пакетов. LGPL-3.0 включает условия GPL-3.0; при
передаче соответствующей серверной сборки нужны оба текста и выполнение
остальных условий LGPL. Официальные тексты:
[LGPL-3.0](https://www.gnu.org/licenses/lgpl-3.0.txt) и
[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.txt).

Уведомления для остальных Python/npm-пакетов нужно собрать и сверить по
фактически передаваемому артефакту согласно
[`docs/RELEASE_LICENSE_CHECKLIST_RU.md`](../docs/RELEASE_LICENSE_CHECKLIST_RU.md).
Один общий текст MIT не заменяет уведомления конкретных правообладателей.
