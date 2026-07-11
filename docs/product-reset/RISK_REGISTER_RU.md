# NewscastNavigator Product Reset — реестр рисков

| ID | Риск | Состояние на Commit 1.5 | Обнаружение | Снижение |
|---|---|---|---|---|
| R01 | Исчезновение текста и сдвиг страницы при autosave | Воспроизведён, не исправлен; крупнейший runtime-риск | component/E2E фиксируют stale suffix loss и `103.03125px > 1px` | local-authoritative state, stable IDs, single-flight, draft в CP3 |
| R02 | Нарушение CaptionPanels mapping | Защищён CP1 characterization, переход ещё впереди | backend characterization на stable story/segment mapping | сохранить stable identifiers и отдельный mapper |
| R03 | Тесты затронут не ту PostgreSQL | Снижен: focused run прошёл в `newscast_product_reset_test` | отдельный Compose project, test DB и cleanup `down -v` | destructive steps только в isolated eval environment; полный rehearsal в CP7 |
| R04 | Auth/bootstrap регрессия при чистой схеме | Открыт | CP2 auth/bootstrap/migration tests | PBKDF2, explicit bootstrap, без legacy fallback |
| R05 | Ложный зелёный eval | Снижен: runner-owned CP1 boundary привязана к `ee8efc5...`; final eval остаётся ожидаемо красным | evaluator проверяет gates/schema/Git tree, сам выполнил семь canonical commands и записал command evidence с hashes/count/summary | неизменяемый checkpoint `evaluated_commit`, clean-source guard и отдельный binding commit; повторять тот же контракт на следующих checkpoints |
| R06 | Устаревший deploy/backup/restore путь останется активным | Открыт | operations inventory и CP7 rehearsal | один local и один demo path, заменённое удалить |
| R07 | Реальные данные попадут в seed/evidence | Снижен policy-контрактом, actual seed ещё не создан | reusable validator и synthetic fixture contract | actual CP2 seed обязан пройти тот же validator |
| R08 | Legacy останется в runtime после перехода | Открыт | phased denylist и repository policy | точный CP2 bridge, окончательный запрет в CP3 |
| R09 | UX оценят по build, без фактического интерфейса | Открыт | CP7 browser evidence на двух размерах | screenshots, axe, before/after и rubric score |
| R10 | Базовые SHA смешаются | Снижен | eval schema и CP1 evidence содержат две базы и exact checkpoint SHAs | два обязательных именованных поля с точными значениями |

## Текущая граница

CP1 hardening source привязан runner-ом к `ee8efc5b04ebe3672f71f0c6c287ee634d994910`: семь command records имеют exit `0`, checkpoint verify прошёл, а final verify вернул ожидаемый exit `2` только из-за `full_eval_passed=false`. Эта граница не исправляет runtime autosave, не создаёт новый seed и не объявляет Product Reset завершённым; `failed_gates` содержит только CP2–CP7 и `external_demo`.
