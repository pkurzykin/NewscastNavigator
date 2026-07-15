# NewscastNavigator Product Reset — реестр рисков

| ID | Риск | Текущее состояние | Обнаружение | Снижение |
|---|---|---|---|---|
| R01 | Исчезновение текста и сдвиг страницы при autosave | Снижен CP3 binding: local-authoritative single-flight, server-expiry recovery через новую lease, adverse-order reload и fixed-layout status прошли component/browser boundary | `57` frontend tests и Playwright на `1366`/`1920`; actual BFCache недоступен в headless и покрыт deterministic lifecycle matrix | повторить UX/BFCache evidence на CP7 boundary и внешней демонстрации |
| R02 | Нарушение CaptionPanels mapping | Снижен CP3 binding: import всегда берёт current accepted scenario, сохраняет stable story/segment IDs и фиксирует exact opened revision | CP1 characterization, CP3 current/latest scenario tests и runner-owned backend full suite | повторить mapping и latest-marker contract на CP7 boundary |
| R03 | Тесты затронут не ту PostgreSQL | Снижен: focused run прошёл в `newscast_product_reset_test` | отдельный Compose project, test DB и cleanup `down -v` | destructive steps только в isolated eval environment; полный rehearsal в CP7 |
| R04 | Auth/bootstrap регрессия при чистой схеме | Снижен CP2 tests; runtime-проверка на демонстрационном deploy впереди | CP2 auth/bootstrap/migration tests | PBKDF2, explicit bootstrap, без legacy fallback |
| R05 | Ложный зелёный eval | Снижен: CP1 привязан к `ee8efc5...`, CP2 — к `60c8f6721bcd3053c11fa2eb2316c8d8e94616fa`, CP3 — к `f867c470e917868e4b039d1d247ba61e8b79b791`; CP3 verify проходит | evaluator проверяет schema, exact commands/counts/hashes, Git ancestry/tree, bridge absence, per-command HEAD/source cleanliness и отдельные checkpoint binding | сохранять source/binding separation и повторять runner-owned boundary на CP4–CP7 |
| R06 | Устаревший deploy/backup/restore путь останется активным | Открыт | operations inventory и CP7 rehearsal | один local и один demo path, заменённое удалить |
| R07 | Реальные данные попадут в seed/evidence | Снижен actual CP2 seed: 8 synthetic users, 30 active и 5 archived stories | reusable validator, CP2 seed tests и exact evidence | повторить policy/seed проверку в CP7 rehearsal |
| R08 | Legacy останется в runtime после перехода | Снижен Commit 3.2: CP2 bridge и заменённые services удалены, old editor GET/PUT отвечают `404` | denylist, repository policy, legacy 404 tests | повторять repository-policy gate на каждой checkpoint boundary |
| R09 | UX оценят по build, без фактического интерфейса | Частично снижен CP3: реальная browser-диагностика нашла hard-reload self-lock/phantom save, после correction обе канонические Playwright-границы проходят на `1366`/`1920`; actual BFCache headless честно skipped | component + stateful Playwright + rendered browser evidence; skip не объявлен успешным actual-BFCache evidence | повторить screenshots, axe, actual BFCache и полный rubric score на CP7 boundary |
| R10 | Базовые SHA смешаются | Снижен | eval schema и CP1 evidence содержат две базы и exact checkpoint SHAs | два обязательных именованных поля с точными значениями |

## Текущая граница

CP3 runner-owned boundary привязан к clean source `f867c470e917868e4b039d1d247ba61e8b79b791`: пять canonical commands прошли, `checkpoint_results.CP3.passed=true`, `missing=[]`, checkpoint verify возвращает `passed=true`. Полные hard gates корректно остаются красными до CP4–CP7 и внешней демонстрации. Следующая граница — CP4 editorial/production workflow.
