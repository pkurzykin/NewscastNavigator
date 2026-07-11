# NewscastNavigator Product Reset — реестр рисков

| ID | Риск | Состояние на Commit 1.1 | Обнаружение | Снижение |
|---|---|---|---|---|
| R01 | Исчезновение текста и сдвиг страницы при autosave | Открыт, крупнейший риск | known-failure component/E2E в Commit 1.3 | local-authoritative state, stable IDs, single-flight, draft в CP3 |
| R02 | Нарушение CaptionPanels mapping | Открыт | characterization contract в Commit 1.3 | сохранить stable story/segment identifiers и отдельный mapper |
| R03 | Тесты затронут не ту PostgreSQL | Снижен skeleton-ом, rehearsal впереди | отдельный Compose project и test DB | destructive steps только в isolated eval environment |
| R04 | Auth/bootstrap регрессия при чистой схеме | Открыт | CP2 auth/bootstrap/migration tests | PBKDF2, explicit bootstrap, без legacy fallback |
| R05 | Ложный зелёный eval | Частично снижен | tests на scope/SHA/computed final state | checkpoint/final separation и external SHA binding |
| R06 | Устаревший deploy/backup/restore путь останется активным | Открыт | operations inventory и CP7 rehearsal | один local и один demo path, заменённое удалить |
| R07 | Реальные данные попадут в seed/evidence | Открыт | synthetic policy в Commit 1.4 | только вымышленные имена, `.invalid`, без contacts/real paths |
| R08 | Legacy останется в runtime после перехода | Открыт | phased denylist и repository policy | точный CP2 bridge, окончательный запрет в CP3 |
| R09 | UX оценят по build, без фактического интерфейса | Открыт | CP7 browser evidence на двух размерах | screenshots, axe, before/after и rubric score |
| R10 | Базовые SHA смешаются | Снижен | eval schema tests | два обязательных именованных поля с точными значениями |

## Текущая граница

Commit 1.1 не исправляет runtime-риски и не объявляет CP1 или Product Reset завершёнными. Он создаёт проверяемый каркас, в котором последующие evidence должны закрывать риски последовательно.
