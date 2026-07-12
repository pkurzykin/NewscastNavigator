# NewscastNavigator Product Reset — реестр рисков

| ID | Риск | Состояние на Commit 1.5 | Обнаружение | Снижение |
|---|---|---|---|---|
| R01 | Исчезновение текста и сдвиг страницы при autosave | Воспроизведён, не исправлен; крупнейший runtime-риск | component/E2E фиксируют stale suffix loss и `103.03125px > 1px` | local-authoritative state, stable IDs, single-flight, draft в CP3 |
| R02 | Нарушение CaptionPanels mapping | Снижен: CP2 bridge сохраняет stable story/segment mapping; окончательная замена впереди | CP1 characterization и CP2 bridge test | сохранить stable identifiers и отдельный mapper в CP3 |
| R03 | Тесты затронут не ту PostgreSQL | Снижен: focused run прошёл в `newscast_product_reset_test` | отдельный Compose project, test DB и cleanup `down -v` | destructive steps только в isolated eval environment; полный rehearsal в CP7 |
| R04 | Auth/bootstrap регрессия при чистой схеме | Снижен CP2 tests; runtime-проверка на демонстрационном deploy впереди | CP2 auth/bootstrap/migration tests | PBKDF2, explicit bootstrap, без legacy fallback |
| R05 | Ложный зелёный eval | CP1 привязан к `ee8efc5...`; CP2 пока не принят и ожидает runner-owned binding | evaluator проверяет gates/schema/Git tree и отдельные checkpoint binding | неизменяемый checkpoint `evaluated_commit`, clean-source guard и отдельный binding commit; повторять тот же контракт на следующих checkpoints |
| R06 | Устаревший deploy/backup/restore путь останется активным | Открыт | operations inventory и CP7 rehearsal | один local и один demo path, заменённое удалить |
| R07 | Реальные данные попадут в seed/evidence | Снижен actual CP2 seed: 8 synthetic users, 30 active и 5 archived stories | reusable validator, CP2 seed tests и exact evidence | повторить policy/seed проверку в CP7 rehearsal |
| R08 | Legacy останется в runtime после перехода | Частично снижен: project runtime удалён, но exact CP2 bridge временно разрешён | phased denylist, repository policy и CP2 bridge test | удалить bridge и окончательно запретить legacy в CP3 |
| R09 | UX оценят по build, без фактического интерфейса | Открыт; CP2 browser runner не дал принятого результата из-за mounted-volume metadata | CP7 browser evidence на двух размерах; CP2 result не объявлен зелёным | устранить browser environment issue, screenshots, axe, before/after и rubric score |
| R10 | Базовые SHA смешаются | Снижен | eval schema и CP1 evidence содержат две базы и exact checkpoint SHAs | два обязательных именованных поля с точными значениями |

## Текущая граница

CP2 template фиксирует single migration, actual synthetic seed, clean schema и единственный временный bridge, но не является принятым evidence до runner-owned command binding на чистом source commit. До этого `failed_gates` содержит CP2–CP7 и `external_demo`; final verify остаётся красным. Browser runner CP2 также не записан как успешная проверка.
