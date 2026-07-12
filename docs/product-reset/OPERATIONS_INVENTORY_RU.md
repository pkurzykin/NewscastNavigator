# NewscastNavigator Product Reset — ранний operations inventory

Классификация выполнена по tracked-файлам на `IMPLEMENTATION_BASE_SHA=a540e47704b26afc02272e6c05e311f48b894f85`. `KEEP` не означает «не менять»: это сохранение назначения. `ADAPT` — привести к новой архитектуре. `REPLACE` — заменить каноническим путём и удалить старый файл в указанном checkpoint.

## Compose, containers и CI

| Файл | Решение | Действие |
|---|---|---|
| `.github/workflows/ci.yml` | ADAPT | Commit 1.1 добавляет isolated policy checks; CP2/CP7 переводят runtime gates на PostgreSQL/final suites |
| `.env.example` | ADAPT | CP7 оставить только обязательные переменные канонического local Compose |
| `compose.yaml` | ADAPT | CP7 оставить каноническим local path и убрать legacy services/volumes |
| `compose.test.yaml` | KEEP | Изолированный PostgreSQL test Compose, создаётся в Commit 1.1 |
| `backend/.dockerignore` | ADAPT | CP7 согласовать build context с каноническим backend image |
| `backend/.env.example` | ADAPT | CP2/CP7 удалить legacy storage/export variables, не добавлять secrets |
| `backend/Dockerfile` | ADAPT | CP7 выровнять с каноническим local/test flow |
| `backend/Dockerfile.prod` | ADAPT | CP7 выровнять с demo deploy и health |
| `frontend/.dockerignore` | ADAPT | CP7 согласовать build context с каноническим frontend image |
| `frontend/.env.example` | ADAPT | CP7 оставить только фактически используемые public build variables |
| `frontend/Dockerfile` | ADAPT | CP7 выровнять с каноническим local flow |
| `frontend/Dockerfile.prod` | ADAPT | CP7 выровнять с demo deploy |
| `frontend/nginx.prod.conf` | ADAPT | CP7 согласовать frontend proxy/static-конфигурацию с каноническим demo compose и health/smoke path |
| `deploy/docker/docker-compose.web-dev.yml` | DELETE | Удалить дублирующий dev path в CP7 |
| `deploy/docker/docker-compose.web-prod.yml` | DELETE | Заменить `deploy/compose.demo.yaml` в CP7 |

## Runtime setup, seed, migration и health

| Файл | Решение | Действие |
|---|---|---|
| `backend/app/api/routes/health.py` | KEEP | Сохранить health endpoint и проверить smoke в CP7 |
| `backend/app/services/bootstrap.py` | REPLACE | Не менять в CP1; удалить при clean schema/demo seed в CP2 |
| `backend/app/services/legacy_import.py` | DELETE | CP2; перенос legacy data не требуется |
| `backend/app/services/runtime_setup.py` | ADAPT | CP2 explicit runtime setup без legacy seed |
| `backend/app/services/staff_import.py` | DELETE | CP2; импорт реальных сотрудников не входит в synthetic bootstrap |
| `backend/scripts/bootstrap_runtime.py` | DELETE | CP2 заменить `bootstrap_admin.py`/migration path |
| `backend/scripts/manage_users.py` | ADAPT | CP2 перевести на function model |
| `backend/scripts/import_legacy_sqlite.py` | DELETE | CP2; миграция legacy data не требуется |
| `backend/scripts/import_staff_xlsx.py` | DELETE | CP2; реальные staff imports вне нового bootstrap |
| `backend/tests/fixtures/synthetic_demo_contract.json` | KEEP | Сохранить CP1 fixture contract как тестовый gate; фактический synthetic seed реализовать в CP2 |
| `backend/tests/synthetic_data_policy.py` | KEEP | Сохранить CP1 reusable synthetic-data policy как тестовый gate; применить к actual seed в CP2 |
| `backend/tests/test_demo_seed_policy.py` | KEEP | Сохранить CP1 policy/contract test gate; расширить проверкой actual synthetic seed в CP2 |
| `backend/migrations/env.py` | ADAPT | CP2 чистая baseline migration |
| `backend/migrations/README` | ADAPT | CP2 документировать один migration path |
| `backend/migrations/script.py.mako` | KEEP | Канонический шаблон Alembic |
| `backend/migrations/versions/20260216_0001_initial_users_projects.py` | DELETE | CP2 |
| `backend/migrations/versions/20260216_0002_script_elements.py` | DELETE | CP2 |
| `backend/migrations/versions/20260217_0003_project_workspace.py` | DELETE | CP2 |
| `backend/migrations/versions/20260315_0004_workflow_foundation.py` | DELETE | CP2 |
| `backend/migrations/versions/20260319_0005_editor_extensibility.py` | DELETE | CP2 |
| `backend/migrations/versions/20260325_0006_segment_uids.py` | DELETE | CP2 |
| `backend/migrations/versions/20260325_0007_rich_text_json.py` | DELETE | CP2 |
| `backend/migrations/versions/20260326_0008_project_revisions.py` | DELETE | CP2 |
| `backend/migrations/versions/20260410_0009_text_state_foundation.py` | DELETE | CP2 |
| `backend/migrations/versions/20260410_0010_project_text_snapshots.py` | DELETE | CP2 |
| `backend/migrations/versions/20260410_0011_titles_track_foundation.py` | DELETE | CP2 |
| `backend/migrations/versions/20260410_0012_edit_track_foundation.py` | DELETE | CP2 |
| `backend/migrations/versions/20260410_0013_voiceover_track_foundation.py` | DELETE | CP2 |
| `backend/migrations/versions/20260410_0014_final_review_track_foundation.py` | DELETE | CP2 |
| `backend/migrations/versions/20260410_0015_user_profiles_and_password_state.py` | DELETE | CP2 |
| `backend/migrations/versions/20260411_0016_project_track_assignees.py` | DELETE | CP2 |
| `backend/migrations/versions/20260411_0017_project_material_links.py` | DELETE | CP2 |
| `backend/migrations/versions/20260411_0018_project_comment_actions.py` | DELETE | CP2 |
| `backend/migrations/versions/20260411_0019_project_comment_text_snapshots.py` | DELETE | CP2 |
| `backend/migrations/versions/20260411_0020_project_comment_revision_snapshots.py` | DELETE | CP2 |
| `backend/migrations/versions/20260415_0021_project_comment_assignments.py` | DELETE | CP2 |
| `backend/migrations/versions/20260424_0022_project_editor_lead.py` | DELETE | CP2 |
| `backend/migrations/versions/20260521_0023_project_source_stage_and_story_date.py` | DELETE | CP2 |

## Smoke, runtime setup и recovery tests

| Файл | Решение | Действие |
|---|---|---|
| `backend/tests/test_api_smoke.py` | DELETE | CP2 удалить вместе с old project/workspace runtime; новые story/API smoke покрываются целевыми вертикальными tests |
| `backend/tests/test_runtime_setup.py` | ADAPT | CP2 перевести на explicit PostgreSQL bootstrap без legacy seed; сохранить production-safety assertions |
| `backend/tests/test_legacy_import.py` | DELETE | CP2 удалить вместе с `legacy_import.py`; перенос legacy data не требуется |

## Deploy, nginx, systemd, backup и restore

| Файл | Решение | Действие |
|---|---|---|
| `deploy/README.md` | ADAPT | CP7 оставить один local и один demo runbook |
| `deploy/env/web-dev.env.example` | DELETE | CP7, заменить каноническим env example |
| `deploy/env/web-prod.env.example` | DELETE | CP7, заменить `deploy/env/demo.env.example` |
| `deploy/nginx/conf.d/.gitkeep` | DELETE | CP7 вместе с пустым legacy path |
| `deploy/nginx/nginx.conf` | ADAPT | CP7 канонический demo proxy |
| `deploy/nginx/edge-nginx.conf` | DELETE | CP7 убрать дублирующий edge layer |
| `deploy/nginx/templates/newscast-web.conf.template` | ADAPT | CP7 согласовать с demo compose |
| `deploy/nginx/templates/edge-proxy.conf.template` | DELETE | CP7 вместе с edge layer |
| `deploy/systemd/.gitkeep` | DELETE | CP7 после определения canonical service layout |
| `deploy/systemd/newscast-web-compose.service` | ADAPT | CP7 demo service на один compose path |
| `deploy/systemd/newscast-web.env.example` | ADAPT | CP7 без secrets и legacy variables |
| `deploy/scripts/backup_db.sh` | ADAPT | CP7 checksum и isolated restore rehearsal |
| `deploy/scripts/restore_db.sh` | ADAPT | CP7 restore только в пустую eval DB |
| `deploy/scripts/backup_exports.sh` | DELETE | CP7: exports удаляются из продукта |
| `deploy/scripts/restore_exports.sh` | DELETE | CP7: exports удаляются из продукта |
| `deploy/scripts/backup_storage.sh` | DELETE | CP7: file storage удаляется из продукта |
| `deploy/scripts/restore_storage.sh` | DELETE | CP7: file storage удаляется из продукта |
| `deploy/scripts/dev_up.sh` | DELETE | CP7 заменить одним canonical local path |
| `deploy/scripts/dev_down.sh` | DELETE | CP7 заменить одним canonical local path |
| `deploy/scripts/dev_logs.sh` | DELETE | CP7 заменить одним canonical local path |
| `deploy/scripts/dev_rebuild.sh` | DELETE | CP7 заменить одним canonical local path |
| `deploy/scripts/dev_native_backend.sh` | DELETE | CP7 убрать дублирующий native path |
| `deploy/scripts/dev_native_frontend.sh` | DELETE | CP7 убрать дублирующий native path |
| `deploy/scripts/setup_backend_venv.sh` | DELETE | CP7 убрать дублирующий native path |
| `deploy/scripts/install_systemd_unit.sh` | ADAPT | CP7 привязать к canonical demo compose |
| `deploy/scripts/uninstall_systemd_unit.sh` | ADAPT | CP7 парный безопасный uninstall |
| `deploy/scripts/install_tls_bundle.sh` | ADAPT | CP7 не читать/не печатать реальные secrets |
| `deploy/scripts/server_audit_snapshot.sh` | DELETE | CP7 заменить воспроизводимым status/evidence path |
| `deploy/scripts/status_prod_stack.sh` | DELETE | CP7 заменить `status_demo_stack.sh` |
| `deploy/scripts/update_prod_stack.sh` | DELETE | CP7 заменить `update_demo_stack.sh` |

## Актуальная эксплуатационная документация

| Файл | Решение | Действие |
|---|---|---|
| `docs/DEPLOYMENT_UBUNTU_RU.md` | ADAPT | CP7 переписать под один канонический local path и один воспроизводимый demo deploy path |
| `docs/LEGACY_DATA_MIGRATION_RU.md` | DELETE | CP7 удалить: совместимость и миграция legacy data не входят в Product Reset |
| `docs/WEB_SMOKE_CHECKLIST_RU.md` | ADAPT | CP7 согласовать с каноническим `deploy/scripts/smoke.sh` и clean-deploy rehearsal |

## Канонические пути и отсутствующие проверки

- Канонический test path уже создаётся: `compose.test.yaml` + PostgreSQL.
- Канонический local и demo path будут утверждены фактическими файлами в CP7; до этого старые пути не объявляются готовыми.
- Отдельного synthetic seed, smoke и clean-deploy rehearsal в Commit 1.1 ещё нет; это открытые gates, а не пропуск inventory.
- Первый inventory не запускает deploy, migration, backup или restore и не обращается к внешним серверам.
