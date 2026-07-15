# NewscastNavigator Product Reset — реестр рисков

| ID | Риск | Текущее состояние | Обнаружение | Снижение |
|---|---|---|---|---|
| R01 | Исчезновение текста и сдвиг страницы при autosave | Снижен Commit 3.2: local-authoritative single-flight сохраняет свежий input; тихий status не меняет layout | component и real-browser regression на двух viewport | повторить UX evidence на CP3/CP7 boundary |
| R02 | Нарушение CaptionPanels mapping | Снижен Commit 3.4: import всегда берёт current accepted scenario, сохраняет stable story/segment IDs и фиксирует exact opened revision | CP1 characterization, CP3.2 current scenario и CP3.4 latest-scenario tests | повторить mapping и latest-marker contract на CP3/CP7 boundary |
| R03 | Тесты затронут не ту PostgreSQL | Снижен: focused run прошёл в `newscast_product_reset_test` | отдельный Compose project, test DB и cleanup `down -v` | destructive steps только в isolated eval environment; полный rehearsal в CP7 |
| R04 | Auth/bootstrap регрессия при чистой схеме | Снижен CP2 tests; runtime-проверка на демонстрационном deploy впереди | CP2 auth/bootstrap/migration tests | PBKDF2, explicit bootstrap, без legacy fallback |
| R05 | Ложный зелёный eval | Снижен: CP1 привязан к `ee8efc5...`, CP2 — к `60c8f6721bcd3053c11fa2eb2316c8d8e94616fa` | evaluator проверяет gates/schema/Git tree и отдельные checkpoint binding | неизменяемый checkpoint `evaluated_commit`, clean-source guard и отдельный binding commit; повторять тот же контракт на следующих checkpoints |
| R06 | Устаревший deploy/backup/restore путь останется активным | Открыт | operations inventory и CP7 rehearsal | один local и один demo path, заменённое удалить |
| R07 | Реальные данные попадут в seed/evidence | Снижен actual CP2 seed: 8 synthetic users, 30 active и 5 archived stories | reusable validator, CP2 seed tests и exact evidence | повторить policy/seed проверку в CP7 rehearsal |
| R08 | Legacy останется в runtime после перехода | Снижен Commit 3.2: CP2 bridge и заменённые services удалены, old editor GET/PUT отвечают `404` | denylist, repository policy, legacy 404 tests | повторять repository-policy gate на каждой checkpoint boundary |
| R09 | UX оценят по build, без фактического интерфейса | Частично снижен: Commit 3.2 прошёл в реальном Chromium на `1366` и `1920`; Commit 3.3 проверен Playwright и встроенным Chromium с synthetic backend, включая diff, restore, modal focus и mobile overflow; полный rubric evidence впереди | component + Playwright + rendered browser evidence; отсутствующий in-app binding в финальном correction-run не объявлен зелёным | повторить screenshots, axe, before/after и rubric score на CP3/CP7 boundary |
| R10 | Базовые SHA смешаются | Снижен | eval schema и CP1 evidence содержат две базы и exact checkpoint SHAs | два обязательных именованных поля с точными значениями |

## Текущая граница

Commit 3.4 фиксирует always-latest CaptionPanels export, exact per-user/context opened marker и server-derived diff status с адресной history-ссылкой. Backend, component, build и browser gates проходят с явно записанными environment limitations; independent review принят после correction rounds. CP3 ещё не закрыт: нужен runner-owned CP3 evidence в Commit 3.5.
