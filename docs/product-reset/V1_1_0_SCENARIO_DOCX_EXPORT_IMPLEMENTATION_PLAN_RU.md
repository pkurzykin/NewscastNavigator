# NewscastNavigator 1.1.0 — шапка сценария и экспорт DOCX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выпустить обратно совместимую версию `1.1.0`: переносить длинное название в синей шапке, хранить свободный хронометраж и скачивать подтверждённый актуальный сценарий как редактируемый DOCX без серверного хранения файлов.

**Architecture:** Существующий единый сценарий остаётся единственным source of truth. `duration_text` проходит через существующую metadata command и latest-wins coordinator. Экспорт сначала синхронно завершает pending-save строк и метаданных, затем отправляет ожидаемый снимок; backend под блокировкой строит immutable snapshot, сравнивает ожидания и передаёт его чистому in-memory DOCX renderer. Никакого legacy/v2-контура, ручных версий или архива экспортов не появляется.

**Статус визуальных правил:** это исторический implementation plan выпуска
`1.1.0`. Его DOCX-правила, отличающиеся от
`V1_1_1_SCENARIO_DOCX_VISUAL_FIXES_DESIGN_RU.md`, заменены утверждённым
контрактом `1.1.1`: голубая шапка только на первой странице без
`w:tblHeader`; `life` выводится в первой колонке с отдельным жирным курсивным
`Лайф`; `zk_geo` начинает первый абзац с `Гео: `; непрерывные bundles одного
непустого имени файла образуют одну группу. Ниже актуализированы связанные
пункты исторического плана; этот документ не является источником текущего
визуального поведения.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 16/SQLite test double, `python-docx 1.2.x`, React 18, TypeScript, TipTap 3, Vitest/Testing Library, Playwright, Docker Compose.

## Global Constraints

- Source of truth: `docs/product-reset/SPEC_RU.md`, `EVAL_RUBRIC_RU.md`, утверждённые `IMPLEMENTATION_PLAN_RU.md` и `V1_1_0_SCENARIO_DOCX_EXPORT_DESIGN_RU.md`.
- Рабочий каталог: `/private/tmp/NewscastNavigator-scenario-docx-export`.
- Текущую ветку `codex/scenario-docx-export-design` в начале выполнения переименовать в `codex/scenario-docx-export`; `main` напрямую не изменять.
- Сначала RED-тест, затем минимальная реализация, затем GREEN. Каждый task завершается релевантными тестами и небольшим локальным commit.
- После каждого checkpoint обновлять `docs/product-reset/PROGRESS.md`: точный commit, команды, исходы, что удалено и оставшиеся риски.
- Не копировать в репозиторий два пользовательских DOCX-референса и не переносить из них реальные названия, фамилии, тексты, пути или metadata.
- Runtime endpoint создаёт DOCX только в `BytesIO`; запрещены temp-файлы, storage-копии, архивы экспортов и cleanup jobs.
- Экспорт не изменяет `stories.updated_at`, `scenario.revision_no`, историю, workflow, production state и уведомления.
- Существующий табличный редактор, sticky-панель, пять типов блоков и CaptionPanels contracts сохраняются.
- `EVAL_RESULT.json`, `DEMO_EVIDENCE.json` и исторические CP1–CP7 evidence не переписывать. Для `1.1.0` расширяется реестр команд `EVAL_COMMANDS.json`; production binding создаётся отдельным evidence-only этапом после фактического deploy.
- Push, PR, merge, tag и deploy не входят в локальную реализацию и требуют новой явной команды владельца продукта.

## Checkpoint map

| Checkpoint | Tasks | Проверяемый результат |
|---|---:|---|
| C1 — metadata/header | 1–3 | `duration_text` хранится и история читаема; длинное название и хронометраж работают в неизменённой синей шапке |
| C2 — canonical DOCX | 4–6 | backend строит согласованный snapshot и отдаёт безопасный in-memory DOCX активного/архивного сюжета |
| C3 — browser flow | 7–8 | один клик ждёт оба save-канала, затем скачивает ровно один подтверждённый DOCX; sticky и archive работают |
| C4 — release readiness | 9–10 | версия `1.1.0`, smoke/eval/render/CodeRabbit/full suites/clean rehearsal зелёные на чистом commit |

---

### Task 1: Зафиксировать Product Reset amendment и baseline C1

**Files:**

- Modify: `docs/product-reset/SPEC_RU.md`
- Modify: `docs/product-reset/EVAL_RUBRIC_RU.md`
- Modify: `docs/product-reset/IMPLEMENTATION_PLAN_RU.md`
- Modify: `docs/product-reset/OPERATIONS_INVENTORY_RU.md`
- Modify: `docs/product-reset/PROGRESS.md`
- Verify only: `backend/tests/characterization/test_editor_contract.py`
- Verify only: `backend/tests/characterization/test_captionpanels_contract.py`
- Verify only: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`
- Verify only: `frontend/e2e/editor-characterization.spec.ts`

**Interfaces:**

- Consumes: утверждённый `V1_1_0_SCENARIO_DOCX_EXPORT_DESIGN_RU.md`.
- Produces: короткую непротиворечивую поправку к основному Product Reset и начальную запись C1.
- Preserves: удаление старого legacy DOCX/PDF и отсутствие пользовательских редакций.

- [ ] **Step 1: Подтвердить чистый isolated worktree и переименовать ветку**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
git status --short --branch
git branch -m codex/scenario-docx-export
git status --short --branch
```

Expected: единственное исходное отличие от `main` — уже committed design; tracked worktree clean.

- [ ] **Step 2: Создать локальные зависимости из lock-файлов**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
python3.11 -m venv .venv
./.venv/bin/python -m pip install --require-hashes -r requirements-dev.lock
cd ../frontend
npm ci
```

Expected: установка проходит только из действующих lock-файлов. `node_modules`, `.venv` не попадают в Git.

- [ ] **Step 3: Запустить неизменённые страховочные contracts**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/pytest -q \
  tests/characterization/test_editor_contract.py \
  tests/characterization/test_captionpanels_contract.py
cd ../frontend
npm test -- --run \
  src/pages/__tests__/EditorPage.characterization.test.tsx
npx playwright test editor-characterization.spec.ts --project=chromium-1366 --workers=1
```

Expected: GREEN. В browser contract уже подтверждены синяя шапка, sticky formatting toolbar, пять блоков, multiple file bundles и отсутствие постоянно висящего CaptionPanels panel.

- [ ] **Step 4: Внести approved amendment в source-of-truth docs**

В `SPEC_RU.md` добавить каноническое правило: один актуальный сценарий может экспортироваться в DOCX; это не manual version и не отдельная копия текста. В `EVAL_RUBRIC_RU.md` добавить критерии C1–C4 из design. В исходном `IMPLEMENTATION_PLAN_RU.md` рядом с удалением legacy export зафиксировать, что запрет относился к старому монолитному endpoint/template/UI и не запрещает новую каноническую функцию `1.1.0`.

В `OPERATIONS_INVENTORY_RU.md` выполнить ранний проход: новый additive migration
— `KEEP`, новый synthetic render helper — `KEEP` как локальный eval tool,
`deploy/scripts/smoke.sh` — `ADAPT`, существующие clean rehearsal/backup/restore,
seed, health и CI paths — `KEEP`; новых deploy/recovery путей не создаётся.

В `PROGRESS.md` открыть раздел `Версия 1.1.0 — шапка сценария и DOCX`, записать base commit `3dd7dba...`, design commit `4e258a7...`, ветку/worktree и baseline-команды без реальных данных.

- [ ] **Step 5: Проверить docs diff и commit**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
git diff --check
git diff -- docs/product-reset/SPEC_RU.md \
  docs/product-reset/EVAL_RUBRIC_RU.md \
  docs/product-reset/IMPLEMENTATION_PLAN_RU.md \
  docs/product-reset/OPERATIONS_INVENTORY_RU.md \
  docs/product-reset/PROGRESS.md
git add docs/product-reset/SPEC_RU.md \
  docs/product-reset/EVAL_RUBRIC_RU.md \
  docs/product-reset/IMPLEMENTATION_PLAN_RU.md \
  docs/product-reset/PROGRESS.md
git commit -m "docs(product): admit canonical scenario DOCX export"
```

Expected: docs-only commit; ни один legacy runtime path не возвращён.

---

### Task 2: Добавить `duration_text` и readable metadata history

**Files:**

- Create: `backend/migrations/versions/20260806_0004_story_duration_text.py`
- Modify: `backend/app/db/models/stories.py`
- Modify: `backend/app/schemas/stories.py`
- Modify: `backend/app/api/routes/stories.py`
- Modify: `backend/app/services/story_service.py`
- Modify: `backend/app/services/story_queries.py`
- Modify: `backend/app/services/scenario_history.py`
- Modify: `backend/tests/test_migration_baseline.py`
- Modify: `backend/tests/test_story_read_models.py`
- Modify: `backend/tests/test_stories_api.py`
- Modify: `backend/tests/test_story_history_api.py`

**Interfaces:**

- Consumes: `PATCH /api/v1/stories/{story_id}/metadata`.
- Produces: `Story.duration_text: str | None`, `StoryListItem.duration_text`, metadata event field `duration_text`.
- Preserves: existing title/rubric permissions and `scenario.revision_no`.

- [ ] **Step 1: Написать RED migration/model/read-model tests**

Добавить assertions:

```python
assert Story.__table__.c.duration_text.type.length == 64
assert Story.__table__.c.duration_text.nullable is True
assert payload["duration_text"] is None
```

`test_migration_baseline.py` должен проверить upgrade пустой БД до `20260806_0004`, nullable column и downgrade только этой migration. `test_story_read_models.py` передаёт `duration_text=None` и ожидает ключ в результате.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/pytest -q tests/test_migration_baseline.py tests/test_story_read_models.py
```

Expected: RED — поля/ревизии migration ещё нет.

- [ ] **Step 2: Реализовать schema migration и read model**

Migration contract:

```python
revision = "20260806_0004"
down_revision = "20260730_0003"

def upgrade() -> None:
    op.add_column("stories", sa.Column("duration_text", sa.String(64), nullable=True))

def downgrade() -> None:
    op.drop_column("stories", "duration_text")
```

Model:

```python
duration_text: Mapped[str | None] = mapped_column(String(64))
```

Добавить `duration_text` в `StoryListItem` и обязательный keyword-аргумент `build_story_list_read_model`. Все callers передают `story.duration_text`; registry UI это поле не показывает.

- [ ] **Step 3: Написать RED command/API/history tests**

Покрыть:

1. `"  до 5 минут  " -> "до 5 минут"`;
2. `"   " -> NULL` и явный JSON `null -> NULL`;
3. длина 65 -> `422 VALIDATION_ERROR`;
4. автор своего сюжета и руководство могут менять, чужой автор получает `403`;
5. архивный сюжет получает `409 STORY_ARCHIVED`;
6. реальное изменение обновляет `updated_at` и создаёт `story_metadata_changed`;
7. no-op не создаёт event;
8. `scenario.revision_no` до/после одинаков;
9. history summary выводит `Хронометраж: «—» → «до 5 минут»`, но не raw JSON.

```bash
./.venv/bin/pytest -q tests/test_stories_api.py tests/test_story_history_api.py
```

Expected: RED — schema отклоняет или игнорирует `duration_text`.

- [ ] **Step 4: Расширить metadata patch без потери explicit-null semantics**

Pydantic:

```python
class StoryMetadataPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    rubric_id: int | None = Field(default=None, ge=1)
    duration_text: str | None = Field(default=None, max_length=64)
```

Route передаёт `fields_set=payload.model_fields_set`. Command signature:

```python
def update_story_metadata(
    db: Session,
    *,
    story_id: int,
    actor: User,
    title: str | None,
    rubric_id: int | None,
    duration_text: str | None,
    fields_set: set[str],
) -> CommandAck:
```

Empty patch определяется по `fields_set`, а не по `None`. Для присутствующего поля:

```python
normalized_duration = duration_text.strip() if duration_text is not None else None
normalized_duration = normalized_duration or None
if story.duration_text != normalized_duration:
    changes["duration_text"] = {"from": story.duration_text, "to": normalized_duration}
    story.duration_text = normalized_duration
```

`scenario_history.py` форматирует `None` как `—`; raw payload наружу не отдаётся.

- [ ] **Step 5: Запустить C1 backend gates**

```bash
./.venv/bin/pytest -q \
  tests/test_migration_baseline.py \
  tests/test_story_read_models.py \
  tests/test_stories_api.py \
  tests/test_story_history_api.py \
  tests/characterization/test_captionpanels_contract.py
```

Expected: GREEN; CaptionPanels contract не изменён.

- [ ] **Step 6: Обновить PROGRESS и commit backend slice**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
git diff --check
git add backend/migrations/versions/20260806_0004_story_duration_text.py \
  backend/app/db/models/stories.py backend/app/schemas/stories.py \
  backend/app/api/routes/stories.py backend/app/services/story_service.py \
  backend/app/services/story_queries.py backend/app/services/scenario_history.py \
  backend/tests/test_migration_baseline.py backend/tests/test_story_read_models.py \
  backend/tests/test_stories_api.py backend/tests/test_story_history_api.py \
  docs/product-reset/PROGRESS.md
git commit -m "feat(stories): add free-form scenario duration"
```

---

### Task 3: Перенести длинное название и добавить хронометраж в синюю шапку

**Files:**

- Modify: `frontend/src/shared/contracts.ts`
- Modify: `frontend/src/features/scenario/types.ts`
- Modify: `frontend/src/features/scenario/metadataSaveCoordinator.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioMetadataHeader.tsx`
- Modify: `frontend/src/features/scenario/components/ScenarioMetadataHeader.test.tsx`
- Modify: `frontend/src/features/scenario/components/ScenarioEditor.tsx`
- Modify: `frontend/src/pages/StoryScenarioPage.tsx`
- Modify: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`
- Modify: `frontend/src/features/stories/StoriesTable.test.tsx`
- Modify: `frontend/src/styles/scenario.css`
- Modify: `frontend/e2e/editor-characterization.spec.ts`
- Modify: `frontend/e2e/story-navigation.spec.ts`
- Modify: `docs/product-reset/PROGRESS.md`

**Interfaces:**

- `ScenarioSnapshot.story.duration_text: string | null`.
- `StoryListItem.duration_text: string | null`; registry table не получает новую колонку.
- `MetadataValues = {title, rubricId, durationText}`.
- `MetadataPatch.duration_text?: string | null`.
- `onChanged`/`onStoryMetadataChanged` may carry `duration_text`.

- [ ] **Step 1: Написать RED coordinator/header tests**

Добавить tests:

```tsx
expect(screen.getByRole("textbox", { name: "Название" }).tagName).toBe("TEXTAREA");
expect(screen.getByRole("textbox", { name: "Хронометраж" })).toHaveValue("");
```

Проверить:

- вставка/ввод `Первая\nВторая` становится `Первая Вторая`;
- `Enter` не создаёт newline;
- textarea увеличивает inline height по `scrollHeight`, не вызывает focus/scroll reset;
- duration trim/empty-to-null/maxLength=64/read-only;
- title + duration + rubric по-прежнему сериализуются одним in-flight request и сохраняют последний desired state;
- acknowledged patch сообщает parent только подтверждённые значения.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/frontend
npm test -- --run src/features/scenario/components/ScenarioMetadataHeader.test.tsx
```

Expected: RED.

- [ ] **Step 2: Расширить types и latest-wins coordinator**

```ts
export interface MetadataValues {
  title: string;
  rubricId: number;
  durationText: string | null;
}

export interface MetadataPatch {
  title?: string;
  rubric_id?: number;
  duration_text?: string | null;
}
```

Добавить `setDesiredDuration(durationText: string | null)`. Во всех `desiredPatch`, projected/in-flight merge, dirty comparison и ack обновлять `durationText`; presence проверять через `!== undefined`, чтобы `null` означал очистку.

Все synthetic `StoryListItem`/scenario fixtures получают
`duration_text: null` или явно проверяемое synthetic значение. Это contract
alignment, а не новая колонка реестра.

- [ ] **Step 3: Реализовать auto-growing single-logical-line title**

В header использовать `textarea rows={1}`, `useLayoutEffect` и helper:

```ts
export function normalizeStoryTitleInput(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ");
}

function resizeTitle(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}
```

`onChange` нормализует значение до записи в coordinator; `onKeyDown` для Enter вызывает `preventDefault()`. Не использовать remount/key при изменении высоты.

Добавить duration input с `maxLength={64}`; onChange пишет raw desired, onBlur делает `trim() || null` и `queueLatestDesired()`.

- [ ] **Step 4: Обновить layout без изменения таблицы**

Desktop grid:

```css
.editor-table-header-panel {
  grid-template-columns: minmax(0, 2fr) minmax(220px, 1fr) minmax(180px, .7fr);
}
.editor-story-title-input {
  min-height: 38px;
  overflow: hidden;
  resize: none;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

На существующем responsive breakpoint перевести grid в одну колонку. Не менять `.editor-table`, column widths, resizers и sticky offset.

- [ ] **Step 5: Расширить component/browser characterization**

Browser test на обоих viewport проверяет синюю шапку, три поля, отсутствие page-level horizontal overflow, рост title textarea, sticky toolbar после scroll и отсутствие CaptionPanels heading. Metadata request test добавляет `duration_text` к существующей проверке serial/latest-wins.

```bash
npm test -- --run \
  src/features/scenario/components/ScenarioMetadataHeader.test.tsx \
  src/pages/__tests__/EditorPage.characterization.test.tsx
npx playwright test editor-characterization.spec.ts \
  --project=chromium-1366 --project=chromium-1920 --workers=1
npm run build
```

Expected: GREEN.

- [ ] **Step 6: Закрыть C1 и commit**

В `PROGRESS.md` записать migration/API/component/browser outcomes и явно отметить: registry/create UI не менялись, technical revision не растёт, CaptionPanels contract green.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
git diff --check
git add frontend/src/shared/contracts.ts frontend/src/features/scenario/types.ts \
  frontend/src/features/scenario/metadataSaveCoordinator.ts \
  frontend/src/features/scenario/components/ScenarioMetadataHeader.tsx \
  frontend/src/features/scenario/components/ScenarioMetadataHeader.test.tsx \
  frontend/src/features/scenario/components/ScenarioEditor.tsx \
  frontend/src/pages/StoryScenarioPage.tsx \
  frontend/src/pages/__tests__/EditorPage.characterization.test.tsx \
  frontend/src/features/stories/StoriesTable.test.tsx \
  frontend/src/styles/scenario.css frontend/e2e/editor-characterization.spec.ts \
  frontend/e2e/story-navigation.spec.ts \
  docs/product-reset/PROGRESS.md
git commit -m "feat(editor): add duration and wrapping title header"
```

---

### Task 4: Построить immutable canonical export snapshot

**Files:**

- Create: `backend/app/schemas/scenario_export.py`
- Create: `backend/app/services/scenario_docx_snapshot.py`
- Create: `backend/tests/test_scenario_docx_snapshot.py`

**Interfaces:**

```python
class ScenarioDocxExportRequest(BaseModel):
    expected_revision: int = Field(ge=0)
    expected_title: str = Field(min_length=1, max_length=255)
    expected_rubric_id: int | None = Field(default=None, ge=1)
    expected_duration_text: str | None = Field(default=None, max_length=64)
```

```python
@dataclass(frozen=True)
class DocxFileBundle:
    file_name: str
    tc_in: str
    tc_out: str

@dataclass(frozen=True)
class ScenarioDocxRow:
    block_type: str
    text: str
    speaker_text: str
    additional_comment: str
    structured_data: Mapping[str, Any]
    formatting: Mapping[str, Any]
    rich_text: Mapping[str, Any]
    file_bundles: tuple[DocxFileBundle, ...]

@dataclass(frozen=True)
class ScenarioDocxSnapshot:
    story_id: int
    title: str
    rubric_id: int
    rubric_name: str
    duration_text: str | None
    revision: int
    rows: tuple[ScenarioDocxRow, ...]
```

- [ ] **Step 1: Написать RED snapshot tests**

Проверить:

- `lock_story_aggregate` даёт Story/Scenario под тем же transactional read;
- строки выбираются `order_index, id`;
- `structured_data.file_bundles` имеет приоритет, invalid entries отбрасываются;
- при отсутствии массива используется legacy primary `file_name/tc_in/tc_out`;
- все вложенные mappings копируются и становятся недоступны для мутации snapshot;
- mismatch каждого из четырёх expected fields возвращает `409 EXPORT_SNAPSHOT_MISMATCH`;
- отсутствующий story -> действующий `404 STORY_NOT_FOUND`;
- builder не вызывает commit и не создаёт event.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/pytest -q tests/test_scenario_docx_snapshot.py
```

Expected: RED — modules отсутствуют.

- [ ] **Step 2: Нормализовать request expectations**

Validators:

```python
@field_validator("expected_title")
@classmethod
def normalize_title(cls, value: str) -> str:
    normalized = " ".join(value.replace("\r", "\n").splitlines()).strip()
    if not normalized:
        raise ValueError("expected_title не может быть пустым")
    return normalized

@field_validator("expected_duration_text")
@classmethod
def normalize_duration(cls, value: str | None) -> str | None:
    normalized = value.strip() if value is not None else ""
    return normalized or None
```

- [ ] **Step 3: Реализовать snapshot builder**

```python
def build_scenario_docx_snapshot(
    db: Session,
    *,
    story_id: int,
    expected: ScenarioDocxExportRequest,
) -> ScenarioDocxSnapshot:
```

Алгоритм:

1. `story, scenario, _, _ = lock_story_aggregate(...)`;
2. прочитать `Rubric` и ordered `ScenarioRow` в той же session/transaction;
3. сравнить tuple `(revision, title, rubric_id, duration_text)` с expected;
4. при mismatch поднять `HTTPException(409, detail={"code": "EXPORT_SNAPSHOT_MISMATCH", "message": "Сюжет изменился. Обновите карточку и повторите экспорт."})`;
5. deep-freeze JSON helper-ом, который рекурсивно превращает `dict` в
   `MappingProxyType`, `list` в `tuple`, а scalar оставляет scalar; списки file
   bundles преобразовать в tuple;
6. вернуть frozen dataclass, не держа ORM entities внутри.

```python
def _freeze_json(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze_json(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze_json(item) for item in value)
    return value
```

- [ ] **Step 4: GREEN и commit**

```bash
./.venv/bin/pytest -q tests/test_scenario_docx_snapshot.py tests/test_story_read_models.py
cd ..
git diff --check
git add backend/app/schemas/scenario_export.py \
  backend/app/services/scenario_docx_snapshot.py \
  backend/tests/test_scenario_docx_snapshot.py
git commit -m "feat(export): build canonical scenario DOCX snapshot"
```

---

### Task 5: Реализовать чистый in-memory DOCX renderer

**Files:**

- Modify: `backend/requirements.txt`
- Modify: `backend/requirements.lock`
- Modify: `backend/requirements-dev.lock`
- Modify: `backend/pyproject.toml`
- Modify: `backend/tests/test_dependency_policy.py`
- Modify: `docs/THIRD_PARTY_NOTICES.md`
- Create: `backend/app/services/scenario_docx_renderer.py`
- Create: `backend/tests/test_scenario_docx_renderer.py`

**Interfaces:**

```python
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

def render_scenario_docx(snapshot: ScenarioDocxSnapshot) -> BytesIO: ...
def safe_docx_filename(title: str, story_id: int) -> tuple[str, str]: ...
```

Первое имя в tuple — ASCII fallback `Scenario-<id>.docx`, второе — очищенное UTF-8 имя.

- [ ] **Step 1: Написать RED dependency-policy test**

Добавить `python-docx` в expected direct runtime set и ожидаемые notices `python-docx: MIT`, `lxml: BSD-3-Clause`.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/pytest -q tests/test_dependency_policy.py -k "direct or notice or license"
```

Expected: RED — dependency/notices отсутствуют.

- [ ] **Step 2: Добавить dependency и воспроизводимо пересобрать locks**

Inputs:

```text
python-docx>=1.2,<2.0
```

Добавить ту же строку в `pyproject.toml`; direct resolved lock обязан содержать `python-docx==1.2.0`. Выполнить документированные Python 3.11 команды:

```bash
./.venv/bin/pip-compile --allow-unsafe --generate-hashes --no-emit-index-url \
  --no-emit-trusted-host --strip-extras \
  --output-file requirements.lock requirements.txt
./.venv/bin/pip-compile --allow-unsafe --generate-hashes --no-emit-index-url \
  --no-emit-trusted-host --strip-extras \
  --output-file requirements-dev.lock requirements.txt requirements-dev.txt
./.venv/bin/python -m pip install --require-hashes -r requirements-dev.lock
./.venv/bin/python scripts/check_dependency_licenses.py --repo-root ..
```

Обновить `THIRD_PARTY_NOTICES.md` точными SPDX лицензиями. Не добавлять файлы шрифтов.

- [ ] **Step 3: Написать RED renderer tests**

Тест строит только synthetic snapshot, вызывает renderer, открывает байты через `python-docx` и `zipfile` и проверяет:

- A4 portrait; margins `3/1.5/2/2 cm`;
- одна таблица, ширина `17.49 cm`, рабочие колонки `9.68/5.26/2.55 cm`;
- две merged metadata rows: первая содержит два жирных центрированных абзаца
  title/rubric, вторая — жирный центрированный duration; header жирный и
  центрированный, первая body-колонка — `JUSTIFY`; `B6DDE8`;
- border size `4` eighths of a point = `0.5 pt`; metadata/header ячейки имеют
  vertical `CENTER`, body ячейки — vertical `TOP`; row height не fixed;
- ровно пять body rows для пяти block types;
- `zk_geo` и `snh` создают отдельные paragraphs; первый `zk_geo` начинается с
  `Гео: `, а `life` выводит в первой колонке отдельный жирный курсивный `Лайф`
  и затем основной text;
- multiple file bundles и `tc_in–tc_out` остаются в порядке; непрерывные
  bundles одного непустого имени образуют одну file-group с одним жирным
  именем, диапазонами и отдельной строкой `+` между диапазонами;
- `additional_comment` идёт отдельным paragraph после bundles;
- PT Sans 12 pt defaults;
- run marks `bold`, `italic`, `strike`, `textStyle.fontFamily`, `highlight.color`;
- неизвестный font -> PT Sans, invalid color -> no shading;
- paragraphs/hardBreak сохраняются, unsupported nodes дают только дочерний visible text;
- stale/invalid TipTap `doc` не может подменить canonical target text: renderer использует plain canonical text с target defaults;
- многостраничный synthetic text не создаёт fixed row height;
- `docProps/core.xml` не содержит username, paths, reference filenames, comments/tracked changes;
- вызов возвращает `BytesIO`, а before/after listing temp/application storage одинаков.

```bash
./.venv/bin/pytest -q tests/test_scenario_docx_renderer.py
```

Expected: RED.

- [ ] **Step 4: Реализовать безопасный rich-text parser**

Whitelists совпадают с frontend:

```python
ALLOWED_FONTS = {"PT Sans", "Arial", "Georgia", "Times New Roman", "Roboto Slab"}
ALLOWED_FILLS = {"#ffffff", "#ffff00", "#ff0000", "#00ff00", "#0000ff", "#ffa500"}
```

Создать внутренние frozen `DocxRunStyle`, `DocxTextRun`, `DocxParagraph`. Рекурсивный parser обрабатывает только:

- `doc`/unknown container: recurse into `content`;
- `paragraph`: новый paragraph;
- `hardBreak`: `run.add_break()` внутри paragraph;
- `text`: строка + marks `bold`, `italic`, `strike`, `textStyle.attrs.fontFamily`, `highlight.attrs.color`.

Marks override defaults; произвольные attrs/style/html не интерпретируются. `rich_target["doc"]` применяется только если вычисленный visible text с сохранёнными paragraph/newline boundaries совпадает с canonical target text; иначе plain canonical text.

Renderer повторяет текущие visual defaults редактора до применения
`formatting.targets`:

```python
def _default_target_style(block_type: str, target: str) -> DocxRunStyle:
    return DocxRunStyle(
        font_family="PT Sans",
        bold=block_type == "snh" and target != "text",
        italic=(
            block_type == "life"
            or (block_type == "zk_geo" and target == "geo")
            or block_type == "snh"
        ),
        strikethrough=False,
        fill_color=None,
    )
```

`#ffffff` означает отсутствие run shading. Остальные разрешённые цвета
задаются через `w:shd`; font family записывается во все `ascii`, `hAnsi`,
`eastAsia`, `cs` slots.

- [ ] **Step 5: Реализовать OOXML layout helpers**

Изолировать private helpers `_set_cell_shading`, `_set_table_borders`,
`_set_cell_width`, `_set_run_fill`. Не принимать raw XML от пользователя.

Renderer:

1. создаёт `Document()` и очищает core properties (`author`, `last_modified_by`, `comments`, `keywords`, `subject`, `title`);
2. выставляет section geometry;
3. создаёт table `3 + len(rows)` x 3, `autofit=False`: metadata rows `0`,
   `1`, header `2`, body начиная с `3`;
4. объединяет три ячейки rows `0` и `1`: первая хранит title/rubric как два
   абзаца, вторая — duration; затем добавляет header и body;
5. не помечает ни одну строку таблицы `w:tblHeader`: голубой блок rows `0..2`
   остаётся только на первой странице;
6. отображает body по approved mapping;
7. сохраняет только в `BytesIO`, `seek(0)`, возвращает buffer.

Canonical target extraction и cell mapping должны быть отдельными pure helpers:

```python
def _target_text(row: ScenarioDocxRow, target: str) -> str:
    if target == "text":
        return row.text
    if target == "geo":
        value = row.structured_data.get("geo", "")
        return value if isinstance(value, str) else ""
    fio, position = (row.speaker_text.split("\n", 1) + [""])[:2]
    return fio if target == "speaker_fio" else position
```

- `podvodka`/`zk`: target `text` в первой cell;
- `zk_geo`: `Гео: <geo>`, затем `text` отдельными paragraphs в первой cell;
- `snh`: `speaker_fio`, `speaker_position`, `text` отдельными paragraphs;
- `life`: отдельный жирный курсивный `Лайф`, затем target `text` в первой cell;
- вторая cell: непрерывные bundles с одинаковым непустым `file_name` образуют
  один paragraph: имя один раз жирным, каждый TC отдельной строкой и `+`
  отдельной строкой между диапазонами; другое имя начинает новую группу,
  bundles без имени не объединяются; после групп отдельный paragraph
  `additional_comment`;
- TC: оба значения — `tc_in–tc_out`, одно значение — оно без служебной подписи;
- пустые значения не создают paragraph/прочерк.

- [ ] **Step 6: Реализовать filename sanitizer**

UTF-8 stem:

- Unicode control, `/\\:*?"<>|`, `..` и path separators заменяются на `-`;
- repeated whitespace/dashes схлопываются;
- trailing dots/spaces удаляются;
- stem ограничен 120 Unicode code points;
- empty или Windows-reserved stem (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
  `LPT1`–`LPT9`, без учёта регистра) -> `Сценарий-<id>.docx`;
- ASCII fallback всегда `Scenario-<id>.docx`.

- [ ] **Step 7: GREEN, reproducible lock check и commit**

```bash
./.venv/bin/pytest -q tests/test_scenario_docx_renderer.py tests/test_dependency_policy.py
./.venv/bin/pip-compile --allow-unsafe --generate-hashes --no-emit-index-url \
  --no-emit-trusted-host --strip-extras \
  --output-file requirements.lock requirements.txt
./.venv/bin/pip-compile --allow-unsafe --generate-hashes --no-emit-index-url \
  --no-emit-trusted-host --strip-extras \
  --output-file requirements-dev.lock requirements.txt requirements-dev.txt
git diff --exit-code -- requirements.lock requirements-dev.lock
cd ..
git diff --check
git add backend/requirements.txt backend/requirements.lock \
  backend/requirements-dev.lock backend/pyproject.toml \
  backend/tests/test_dependency_policy.py docs/THIRD_PARTY_NOTICES.md \
  backend/app/services/scenario_docx_renderer.py \
  backend/tests/test_scenario_docx_renderer.py
git commit -m "feat(export): render scenario DOCX in memory"
```

---

### Task 6: Опубликовать authenticated export endpoint без side effects

**Files:**

- Modify: `backend/app/api/routes/scenario.py`
- Create: `backend/tests/test_scenario_docx_export_api.py`
- Modify: `backend/tests/characterization/test_captionpanels_contract.py` only if an explicit unchanged-route assertion is needed
- Modify: `docs/product-reset/PROGRESS.md`

**Interfaces:**

- `POST /api/v1/stories/{story_id}/scenario/export-docx`.
- Request: `ScenarioDocxExportRequest`.
- Response: DOCX bytes, `Content-Type`, RFC 5987 `Content-Disposition`, `Cache-Control: no-store`.

- [ ] **Step 1: Написать RED API tests**

Покрыть:

- unauthenticated -> `401 AUTH_REQUIRED`;
- missing story -> `404 STORY_NOT_FOUND`;
- active and archived scenario -> `200` for any authenticated user who can read the story;
- exact expected fields required; invalid length/revision -> `422`;
- mismatch -> `409` and exact code/message;
- response `Content-Type`, ASCII `filename=`, UTF-8 `filename*=UTF-8''...`, `no-store`;
- malicious/path-like title does not inject CR/LF/path into headers;
- response is non-empty ZIP/DOCX and can be reopened;
- before/after `Story.updated_at`, revision, events, workflow, production, notifications equal;
- duplicate calls return valid bytes and create zero persisted export records/files.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/pytest -q tests/test_scenario_docx_export_api.py
```

Expected: RED — route отсутствует.

- [ ] **Step 2: Добавить route с обычной session-cookie auth**

```python
@router.post("/{story_id}/scenario/export-docx")
def export_story_scenario_docx(
    story_id: int,
    payload: ScenarioDocxExportRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> Response:
    snapshot = build_scenario_docx_snapshot(db, story_id=story_id, expected=payload)
    buffer = render_scenario_docx(snapshot)
    fallback, utf8_name = safe_docx_filename(snapshot.title, story_id)
    return Response(
        content=buffer.getvalue(),
        media_type=DOCX_CONTENT_TYPE,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{fallback}"; '
                f"filename*=UTF-8''{quote(utf8_name, safe='')}"
            ),
            "Cache-Control": "no-store",
        },
    )
```

Не вызывать `db.commit()`, не принимать bearer как альтернативу browser session, не создавать background task.

- [ ] **Step 3: Запустить C2 gates**

```bash
./.venv/bin/pytest -q \
  tests/test_scenario_docx_snapshot.py \
  tests/test_scenario_docx_renderer.py \
  tests/test_scenario_docx_export_api.py \
  tests/test_stories_api.py \
  tests/characterization/test_editor_contract.py \
  tests/characterization/test_captionpanels_contract.py
```

Expected: GREEN.

- [ ] **Step 4: Обновить PROGRESS и commit C2**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
git diff --check
git add backend/app/api/routes/scenario.py \
  backend/tests/test_scenario_docx_export_api.py \
  backend/tests/characterization/test_captionpanels_contract.py \
  docs/product-reset/PROGRESS.md
git commit -m "feat(export): serve revision-safe scenario DOCX"
```

Если characterization файл фактически не менялся, не добавлять его в commit.

---

### Task 7: Добавить awaitable flush и binary API transport

**Files:**

- Modify: `frontend/src/shared/api/client.ts`
- Create: `frontend/src/shared/api/client.test.ts`
- Modify: `frontend/src/features/scenario/api.ts`
- Modify: `frontend/src/features/scenario/types.ts`
- Modify: `frontend/src/features/scenario/useScenarioAutosave.ts`
- Modify: `frontend/src/features/scenario/useScenarioAutosave.test.tsx`
- Modify: `frontend/src/features/scenario/metadataSaveCoordinator.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioMetadataHeader.test.tsx`

**Interfaces:**

```ts
export interface ScenarioDocxExportRequest {
  expected_revision: number;
  expected_title: string;
  expected_rubric_id: number | null;
  expected_duration_text: string | null;
}

export interface ScenarioDocxDownload {
  blob: Blob;
  filename: string;
}
```

```ts
apiResponse(path: string, init?: RequestInit): Promise<Response>
useScenarioAutosave(...).flushPending(): Promise<number>
MetadataSaveCoordinator.flushLatestDesired(): Promise<MetadataValues>
```

- [ ] **Step 1: Написать RED raw-response tests**

`client.test.ts` проверяет, что `apiResponse`:

- добавляет `credentials: "include"`;
- ставит JSON content type только при body;
- на `ok` не вызывает `response.json()` и возвращает binary response;
- на error безопасно разбирает существующий JSON envelope и бросает `ApiError` с status/code/message;
- `apiRequest` после refactor сохраняет прежний JSON contract.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/frontend
npm test -- --run src/shared/api/client.test.ts
```

Expected: RED.

- [ ] **Step 2: Разделить transport и parsing**

```ts
export async function apiResponse(path: string, init: RequestInit = {}): Promise<Response> {
  // existing headers + credentials
  const response = await fetch(...);
  if (!response.ok) await throwApiError(response);
  return response;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await apiResponse(path, init)).json() as Promise<T>;
}
```

`exportScenarioDocx` POST-ит expectation, получает `blob()`, извлекает `filename*` с fallback `Scenario-<id>.docx` и возвращает `ScenarioDocxDownload`.

- [ ] **Step 3: Написать RED autosave flush tests**

Проверить:

1. clean state сразу resolve текущей revision без lease/save;
2. pending debounce отменяется и save начинается сразу;
3. old in-flight + newer latest: flush ждёт ack обоих, возвращает последнюю revision;
4. save/network error reject и draft остаётся;
5. revision conflict reject, local conflict state остаётся;
6. смена story/user scope reject старых waiters и не разрешает их revision нового сюжета;
7. multiple simultaneous flush callers завершаются одним save chain.

```bash
npm test -- --run src/features/scenario/useScenarioAutosave.test.tsx
```

Expected: RED.

- [ ] **Step 4: Реализовать `flushPending()` через waiters**

Добавить generation-bound waiters. `flushPending()`:

- reject сразу при `conflictRef.current`;
- clear pending timer;
- если dirty snapshot и есть in-flight — положить самый новый clone в `queuedRef`;
- если dirty snapshot без in-flight — вызвать `send` немедленно;
- resolve только когда timer/in-flight/queue отсутствуют, `dirtyRef=false`, status не error/conflict;
- reject всеми сохранёнными waiters при terminal save error/conflict/unmount/scope change;
- никогда не очищать draft до ack последнего snapshot.

После каждого branch в `send.finally` вызывать `settleFlushWaiters()`.

- [ ] **Step 5: Написать RED metadata flush tests**

Проверить clean, pending title+duration, in-flight old + latest desired, explicit null, validation error, network error, unmount/remount retention и несколько callers.

- [ ] **Step 6: Реализовать `flushLatestDesired()`**

Метод нормализует title/duration, валидирует непустой title, вызывает `queueLatestDesired()`, ждёт полного drain и возвращает копию persisted. На request error reject текущих waiters, но сохраняет desired/queued state и navigation blocker для обычного retry.

- [ ] **Step 7: GREEN и commit**

```bash
npm test -- --run \
  src/shared/api/client.test.ts \
  src/features/scenario/useScenarioAutosave.test.tsx \
  src/features/scenario/components/ScenarioMetadataHeader.test.tsx
npm run build
cd ..
git diff --check
git add frontend/src/shared/api/client.ts frontend/src/shared/api/client.test.ts \
  frontend/src/features/scenario/api.ts frontend/src/features/scenario/types.ts \
  frontend/src/features/scenario/useScenarioAutosave.ts \
  frontend/src/features/scenario/useScenarioAutosave.test.tsx \
  frontend/src/features/scenario/metadataSaveCoordinator.ts \
  frontend/src/features/scenario/components/ScenarioMetadataHeader.test.tsx
git commit -m "feat(export): await latest editor state before download"
```

---

### Task 8: Добавить sticky «Экспорт DOCX» и fail-closed browser flow

**Files:**

- Create: `frontend/src/features/scenario/scenarioDocxExportCoordinator.ts`
- Create: `frontend/src/features/scenario/scenarioDocxExportCoordinator.test.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioEditor.tsx`
- Modify: `frontend/src/features/scenario/ScenarioEditor.autosave.test.tsx`
- Modify: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`
- Modify: `frontend/src/styles/scenario.css`
- Create: `frontend/e2e/scenario-docx-export.spec.ts`
- Modify: `docs/product-reset/PROGRESS.md`

**Interfaces:**

```ts
export interface ExportState {
  revision: number;
  title: string;
  rubricId: number | null;
  durationText: string | null;
}

export async function prepareScenarioDocxDownload(options: {
  readOnly: boolean;
  current: () => ExportState;
  flushScenario: () => Promise<number>;
  flushMetadata: () => Promise<MetadataValues>;
  request: (payload: ScenarioDocxExportRequest) => Promise<ScenarioDocxDownload>;
}): Promise<ScenarioDocxDownload>;

export function triggerBrowserDownload(download: ScenarioDocxDownload): void;
```

- [ ] **Step 1: Написать RED pure coordinator tests**

Проверить exact ordering:

```ts
expect(events).toEqual([
  "flush-scenario:start",
  "flush-metadata:start",
  "flush-scenario:ack",
  "flush-metadata:ack",
  "export-request",
]);
```

Также проверить:

- expectation использует returned revision/persisted metadata, не старый render snapshot;
- read-only active-held/archive пропускает оба flush и использует canonical loaded state;
- rejection любого flush не вызывает request/download;
- request rejection не вызывает download;
- `triggerBrowserDownload` создаёт object URL, click одного temporary anchor, затем revoke/remove.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/frontend
npm test -- --run src/features/scenario/scenarioDocxExportCoordinator.test.ts
```

Expected: RED.

- [ ] **Step 2: Реализовать coordinator и editor state**

В `ScenarioEditor` добавить `exporting`, `exportError`. При click:

1. если `exporting`, return;
2. получить тот же `getMetadataSaveCoordinator(storyId, initial)` — map гарантирует единый coordinator с header;
3. вызвать `prepareScenarioDocxDownload`;
4. только после resolved download вызвать `triggerBrowserDownload`;
5. на ошибке показать `role="alert"` русским текстом; локальные rows/desired metadata не заменять;
6. в `finally` снять busy state.

Кнопка:

```tsx
<button
  type="button"
  className="secondary editor-docx-export-button"
  disabled={exporting}
  aria-busy={exporting}
  onClick={() => void handleDocxExport()}
>
  {exporting ? "Подготавливаем DOCX…" : "Экспорт DOCX"}
</button>
```

- [ ] **Step 3: Сохранить sticky toolbar и read-only export**

Вынести `.editor-toolbar-sticky` за условие `!readOnly`. Кнопка экспорта видима всегда после загрузки snapshot. Editing/add/delete/format controls остаются только внутри `!readOnly`. Для read-only toolbar card не показывает пустой formatting toolbar.

Не менять таблицу, row controls и sticky top offset. Добавить compact export action layout на 1366 и 1920.

- [ ] **Step 4: Написать component integration tests**

`ScenarioEditor.autosave.test.tsx`/characterization проверяют:

- text input непосредственно перед click вызывает PUT и ожидается ack;
- title/duration непосредственно перед click вызывают PATCH и ожидается ack;
- POST export идёт после обоих и содержит new revision/title/rubric/duration;
- два быстрых click дают один POST;
- save, `SCENARIO_REVISION_CONFLICT`, metadata error и export `409` дают alert и zero anchor clicks;
- held и archived показывают кнопку и POST без PUT/PATCH;
- formatting toolbar остаётся один и sticky;
- CaptionPanels API/routes/status не меняются.

- [ ] **Step 5: Написать Playwright download test**

`scenario-docx-export.spec.ts` использует synthetic API fixture и проверяет на `chromium-1366` и `chromium-1920`:

1. длинный title/duration не создают `documentElement.scrollWidth > clientWidth`;
2. после `window.scrollTo(0, 700)` button остаётся ниже `.app-shell-header` и видим;
3. изменить rich text и duration, сразу click;
4. порядок PUT/PATCH before POST и exact expectation;
5. `page.waitForEvent("download")` получает один `.docx`, suggested filename и non-zero stream;
6. archive fixture не выполняет save;
7. export error не создаёт download.

Binary mock должен быть минимальным synthetic ZIP/DOCX без реальных данных.

- [ ] **Step 6: Запустить C3 gates**

```bash
npm test -- --run \
  src/features/scenario/scenarioDocxExportCoordinator.test.ts \
  src/features/scenario/ScenarioEditor.autosave.test.tsx \
  src/pages/__tests__/EditorPage.characterization.test.tsx
npx playwright test scenario-docx-export.spec.ts editor-characterization.spec.ts \
  --project=chromium-1366 --project=chromium-1920 --workers=1
npm run build
```

Expected: GREEN; download ровно один, sticky/blue header/table contracts сохранены.

- [ ] **Step 7: Обновить PROGRESS и commit C3**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
git diff --check
git add frontend/src/features/scenario/scenarioDocxExportCoordinator.ts \
  frontend/src/features/scenario/scenarioDocxExportCoordinator.test.ts \
  frontend/src/features/scenario/components/ScenarioEditor.tsx \
  frontend/src/features/scenario/ScenarioEditor.autosave.test.tsx \
  frontend/src/pages/__tests__/EditorPage.characterization.test.tsx \
  frontend/src/styles/scenario.css frontend/e2e/scenario-docx-export.spec.ts \
  docs/product-reset/PROGRESS.md
git commit -m "feat(editor): download the latest confirmed scenario DOCX"
```

---

### Task 9: Добавить release metadata, eval registry и operational smoke

**Files:**

- Modify: `backend/pyproject.toml`
- Modify: `backend/app/core/version.py`
- Modify: `backend/tests/test_app_version.py`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `docs/product-reset/EVAL_COMMANDS.json`
- Modify: `backend/tests/test_product_reset_eval.py`
- Modify: `deploy/scripts/smoke.sh`
- Modify: `backend/tests/test_operations_contract.py`
- Modify: `deploy/README.md`
- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`
- Modify: `docs/product-reset/DEMO_RUNBOOK_RU.md`
- Modify: `docs/product-reset/RISK_REGISTER_RU.md`
- Modify: `docs/product-reset/OPERATIONS_INVENTORY_RU.md`
- Create: `backend/scripts/render_synthetic_scenario_docx.py`
- Create: `backend/tests/test_render_synthetic_scenario_docx.py`
- Modify: `docs/product-reset/PROGRESS.md`

**Interfaces:**

- Produces one version string `1.1.0` in backend/frontend metadata/footer.
- Adds `execution_group: "v1_1_0_local"` commands to existing eval registry without mutating historical result.
- Authenticated smoke exports one canonical story to client-side temp and verifies headers/ZIP; runtime server still writes nothing.

- [ ] **Step 1: Написать RED version/eval/ops tests**

`test_app_version.py` должен требовать exact set `{"1.1.0"}`. В `test_product_reset_eval.py` добавить exact registry contract:

```python
V1_1_0_EXPECTED_COMMANDS = {
    "v1-1-0-backend-full": "cd backend && ./.venv/bin/pytest -q",
    "v1-1-0-frontend-full": "cd frontend && npm test -- --run",
    "v1-1-0-frontend-build": "cd frontend && npm run build",
    "v1-1-0-browser": (
        "cd frontend && npx playwright test scenario-docx-export.spec.ts "
        "editor-characterization.spec.ts --project=chromium-1366 "
        "--project=chromium-1920 --workers=1"
    ),
    "v1-1-0-compose-root": "docker compose --env-file .env.example -f compose.yaml config",
    "v1-1-0-compose-test": "docker compose -f compose.test.yaml config",
    "v1-1-0-compose-demo": (
        "docker compose --env-file deploy/env/demo.env.example "
        "-f deploy/compose.demo.yaml config"
    ),
}
```

Каждая запись: `scope="release"`, `release="1.1.0"`, expected `0`.

Operations test требует authenticated smoke steps `scenario GET`, `export-docx POST`, DOCX content type, `Content-Disposition`, `Cache-Control: no-store`, `zipfile.is_zipfile` и output boolean `docx_export`.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/pytest -q \
  tests/test_app_version.py \
  tests/test_product_reset_eval.py -k "v1_1_0" \
  tests/test_operations_contract.py -k "smoke"
```

Expected: RED.

- [ ] **Step 2: Синхронизировать version `1.1.0`**

Изменить backend project/FALLBACK и frontend package/package-lock root version. Добавить changelog:

```markdown
## [1.1.0] - 2026-08-06

### Added
- Свободный хронометраж в шапке сценария.
- Экспорт актуального подтверждённого сценария в редактируемый DOCX.

### Changed
- Длинное название полностью переносится в синей шапке редактора.
```

Не обещать PDF, archive exports или font embedding.

- [ ] **Step 3: Расширить machine-readable eval commands**

Добавить семь exact records в `EVAL_COMMANDS.json`; исторические records и `EVAL_RESULT.json` оставить byte-for-byte неизменными. Test сравнивает exact IDs/order/commands/fields.

- [ ] **Step 4: Расширить authenticated smoke**

После story list:

1. получить первый story id;
2. GET `/api/v1/stories/<id>/scenario`;
3. Python stdlib формирует JSON expectation из canonical response;
4. POST export с session cookie в `${TMP_DIR}/scenario.docx`;
5. проверить status `200`, exact content type, `attachment`, `no-store`, non-zero size и `zipfile.is_zipfile`;
6. не печатать cookie, password, story text или DOCX bytes;
7. temporary client file удаляется существующим trap.

Smoke JSON получает `"docx_export": true` только для authenticated path; unauthenticated run — `false`.

- [ ] **Step 5: Добавить только synthetic render fixture script**

`render_synthetic_scenario_docx.py --output PATH` строит `ScenarioDocxSnapshot` без БД и реальных данных: длинный title, empty/non-empty duration variants, пять blocks, multiple bundles, длинный multi-page text и все whitelisted formatting. Скрипт требует явный output, отказывается писать symlink/не-`.docx`, создаёт parent только под `artifacts/product-reset/V1_1_0/docx-export` или `/tmp`, вызывает production renderer и пишет локальный eval artifact. Он не импортируется runtime route и не создаёт серверный архив.

Test запускает script в `tmp_path`, открывает DOCX и проверяет synthetic markers/absence real sample markers.

- [ ] **Step 6: Обновить runbooks и risk register**

Зафиксировать:

- браузер сам предлагает/выбирает download folder;
- server temp/storage остаются неизменными;
- smoke проверяет export только при credentials;
- rollback `1.1.0` требует application images + DB restore из predeploy backup из-за additive migration;
- новый risk: font substitution на машинах без PT Sans/allowed font, mitigation — Word font names and render QA, no embedding;
- новый risk: download mismatch при concurrent edit, mitigation — fail-closed `409` and retry after refresh, local text preserved.

Завершить второй inventory pass: фактические пути migration, dependency locks,
smoke, synthetic render helper, clean rehearsal, backup/restore, seed, health и
CI сверить с ранними `KEEP/ADAPT`; отсутствие нового параллельного deploy path
записать явно.

- [ ] **Step 7: GREEN и commit release slice**

```bash
./.venv/bin/pytest -q \
  tests/test_app_version.py \
  tests/test_product_reset_eval.py \
  tests/test_operations_contract.py \
  tests/test_render_synthetic_scenario_docx.py
cd ../frontend
npm install --package-lock-only --ignore-scripts
npm test -- --run
npm run build
cd ..
git diff --check
git add backend/pyproject.toml backend/app/core/version.py \
  backend/tests/test_app_version.py frontend/package.json frontend/package-lock.json \
  CHANGELOG.md docs/product-reset/EVAL_COMMANDS.json \
  backend/tests/test_product_reset_eval.py deploy/scripts/smoke.sh \
  backend/tests/test_operations_contract.py deploy/README.md \
  docs/WEB_SMOKE_CHECKLIST_RU.md docs/product-reset/DEMO_RUNBOOK_RU.md \
  docs/product-reset/RISK_REGISTER_RU.md \
  docs/product-reset/OPERATIONS_INVENTORY_RU.md \
  backend/scripts/render_synthetic_scenario_docx.py \
  backend/tests/test_render_synthetic_scenario_docx.py \
  docs/product-reset/PROGRESS.md
git commit -m "chore(release): prepare Newscast Navigator 1.1.0"
```

---

### Task 10: Полная C4 verification, visual DOCX eval и CodeRabbit

**Files:**

- Modify: `docs/product-reset/PROGRESS.md`
- Untracked/ignored evidence only: `artifacts/product-reset/V1_1_0/docx-export/**`
- Untracked/ignored evidence only: `artifacts/product-reset/V1_1_0/ops/**`

**Interfaces:**

- Produces: exact local evaluated commit, hashes/render page count, full test outcomes, CodeRabbit disposition and clean rehearsal run.
- Does not produce: push/PR/tag/deploy or tracked real data.

- [ ] **Step 1: Запустить focused contract set**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/pytest -q \
  tests/test_migration_baseline.py \
  tests/test_stories_api.py \
  tests/test_story_history_api.py \
  tests/test_scenario_docx_snapshot.py \
  tests/test_scenario_docx_renderer.py \
  tests/test_scenario_docx_export_api.py \
  tests/test_dependency_policy.py \
  tests/test_operations_contract.py \
  tests/characterization/test_editor_contract.py \
  tests/characterization/test_captionpanels_contract.py
cd ../frontend
npm test -- --run \
  src/features/scenario/components/ScenarioMetadataHeader.test.tsx \
  src/features/scenario/useScenarioAutosave.test.tsx \
  src/features/scenario/scenarioDocxExportCoordinator.test.ts \
  src/features/scenario/ScenarioEditor.autosave.test.tsx \
  src/pages/__tests__/EditorPage.characterization.test.tsx
```

Expected: GREEN.

- [ ] **Step 2: Создать и визуально проверить synthetic DOCX**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
mkdir -p artifacts/product-reset/V1_1_0/docx-export/rendered
cd backend
./.venv/bin/python scripts/render_synthetic_scenario_docx.py \
  --output ../artifacts/product-reset/V1_1_0/docx-export/synthetic-scenario.docx
cd ..
soffice --headless --convert-to pdf \
  --outdir artifacts/product-reset/V1_1_0/docx-export \
  artifacts/product-reset/V1_1_0/docx-export/synthetic-scenario.docx
pdftoppm -png -r 144 \
  artifacts/product-reset/V1_1_0/docx-export/synthetic-scenario.pdf \
  artifacts/product-reset/V1_1_0/docx-export/rendered/page
shasum -a 256 artifacts/product-reset/V1_1_0/docx-export/synthetic-scenario.docx
```

Открыть через `view_image` **каждый** `rendered/page-*.png`. Записать page count и verdict: нет clipping, overlap, accidental blank pages, broken columns; все пять blocks/multiple files/formats видимы. Если `soffice`/`pdftoppm` отсутствуют — установить/подключить document runtime, а не пропускать gate.

- [ ] **Step 3: Проверить OOXML privacy и filesystem boundary**

```bash
python3 -m zipfile -l artifacts/product-reset/V1_1_0/docx-export/synthetic-scenario.docx
python3 -m zipfile -e \
  artifacts/product-reset/V1_1_0/docx-export/synthetic-scenario.docx \
  /tmp/newscast-v110-docx-inspect
rg -n "Users/|Volumes/|work-local|lastModifiedBy|comments" \
  /tmp/newscast-v110-docx-inspect
rm -rf /tmp/newscast-v110-docx-inspect
```

Expected: первый command показывает валидный package; `rg` не находит реальные reference data/paths/user properties. Удалить inspection directory после проверки.

- [ ] **Step 4: Запустить full automated/browser/build/compose gates**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/pytest -q
./.venv/bin/python scripts/check_dependency_licenses.py --repo-root ..
cd ../frontend
npm ci
npm test -- --run
npm run build
npx playwright test --project=chromium-1366 --project=chromium-1920 --workers=1
cd ..
docker compose --env-file .env.example -f compose.yaml config
docker compose -f compose.test.yaml config
docker compose --env-file deploy/env/demo.env.example -f deploy/compose.demo.yaml config
```

Expected: all exit `0`. Если исторический Product Reset evaluator снова зависает на full-history exact-subtree test на external volume, не засчитывать как pass: повторить evaluator в fresh local full-history clone и записать фактический outcome/command.

```bash
rm -rf /tmp/NewscastNavigator-v110-eval-clone
git clone --no-local /private/tmp/NewscastNavigator-scenario-docx-export \
  /tmp/NewscastNavigator-v110-eval-clone
git -C /tmp/NewscastNavigator-v110-eval-clone checkout --detach \
  "$(git -C /private/tmp/NewscastNavigator-scenario-docx-export rev-parse HEAD)"
cd /tmp/NewscastNavigator-v110-eval-clone/backend
python3.11 -m venv .venv
./.venv/bin/python -m pip install --require-hashes -r requirements-dev.lock
./.venv/bin/pytest -q tests/test_product_reset_eval.py
```

После записи результата удалить только созданный clone
`/tmp/NewscastNavigator-v110-eval-clone`.

- [ ] **Step 5: Запустить machine-readable release group и historical final verifier**

Выполнить все records `execution_group=v1_1_0_local` из `EVAL_COMMANDS.json` ровно один раз и сверить exit code. Затем:

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export/backend
./.venv/bin/python scripts/product_reset_eval.py verify --scope final --repo-root ..
```

Expected: historical final verifier не должен получать новых ошибок из-за `1.1.0`; если он fail-closed только из-за stale exact-SHA production binding, это внешний gate, а не локальный pass. Точный список ошибок записать без подмены на «зелёный».

- [ ] **Step 6: Выполнить CodeRabbit whole-branch review**

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
coderabbit doctor
coderabbit review --committed --base main
coderabbit review findings
```

Для каждого actionable finding:

1. воспроизвести/подтвердить;
2. добавить RED regression;
3. исправить минимально;
4. прогнать focused + affected full gate;
5. commit `fix(review): ...`;
6. повторить whole-branch review до отсутствия actionable findings.

Не принимать предложение, которое возвращает legacy export/manual versions, нарушает in-memory boundary или CaptionPanels contract.

- [ ] **Step 7: Записать локальные evidence и commit progress**

В `PROGRESS.md` записать exact implementation commit, full counts/durations, browser projects, artifact SHA/page count, CodeRabbit findings/disposition, known npm advisories без заявления об их исправлении и ожидаемый внешний production binding gate.

```bash
cd /private/tmp/NewscastNavigator-scenario-docx-export
git add docs/product-reset/PROGRESS.md
git commit -m "docs(progress): record scenario DOCX local verification"
```

- [ ] **Step 8: На чистом финальном HEAD выполнить canonical clean-deploy rehearsal**

Сначала повторить `coderabbit review --committed --base main`, чтобы
docs/progress commit также входил в reviewed diff. Actionable finding снова
проходит RED/fix/focused/full/commit loop; rehearsal запускается только после
нулевого actionable результата и clean status.

```bash
git status --short
./deploy/scripts/rehearse_clean_deploy.sh \
  --project-name nn-product-reset-eval-v110-local \
  --artifacts artifacts/product-reset/V1_1_0/ops
git status --short
git diff --check main...HEAD
```

Expected:

- tracked worktree clean до/после;
- fresh PostgreSQL migration включает `20260806_0004`;
- synthetic seed, health, authenticated smoke с DOCX, backup checksum, restore в пустую DB, post-restore smoke, logs validation и cleanup — passed;
- result/manifest bind exact final HEAD;
- source/restore containers, networks и volumes отсутствуют после cleanup.

- [ ] **Step 9: Финальный no-secret/no-reference audit**

```bash
git grep -n -I -E "work-local|/Users/pavelkurzykin/|reference-docx-source" -- . \
  ':!docs/product-reset/V1_1_0_SCENARIO_DOCX_EXPORT_DESIGN_RU.md' \
  ':!docs/product-reset/V1_1_0_SCENARIO_DOCX_EXPORT_IMPLEMENTATION_PLAN_RU.md'
git status --short --branch
git log --oneline --decorate main..HEAD
```

Expected: no committed sample content/paths; branch clean; только осмысленные local commits.

---

## External integration gate — отдельная команда владельца

На локальном завершении остановиться и сообщить:

- exact branch/HEAD;
- checkpoints и commits;
- focused/full/browser/render/rehearsal outcomes;
- CodeRabbit disposition;
- historical evaluator outcome и stale production evidence;
- rollback impact additive migration;
- где находится ignored synthetic DOCX/render evidence.

Только после отдельного разрешения составить и выполнить release-последовательность: push → PR → CI/CodeRabbit PR review → merge exact SHA → predeploy PostgreSQL backup/restore-list → migration → замена backend/frontend → public/authenticated/CaptionPanels/DOCX smoke → real-browser check → tag `v1.1.0` → отдельный evidence-only binding. Production credentials и реальные данные не выводить и не коммитить.

## Definition of Done

- [ ] `duration_text` nullable/max64/trim/empty-null работает с прежними правами и readable history без revision bump.
- [ ] Long title visually wraps, но данные не содержат newline; focus/selection/scroll contracts сохранены.
- [ ] Active export ждёт latest scenario + metadata ack; archive/held export не пытается сохранять.
- [ ] Backend exact-match snapshot fail-closed с `EXPORT_SNAPSHOT_MISMATCH`.
- [ ] DOCX A4/table/columns/block mapping/run formatting полностью покрыты structural tests и all-page render QA.
- [ ] Сервер не создаёт temp/storage/archive DOCX и export не имеет side effects.
- [ ] Sticky export доступен на active/held/archive; errors не запускают download.
- [ ] CaptionPanels characterization, full backend/frontend, both desktop Playwright, builds, licenses, compose и clean rehearsal green.
- [ ] Version/changelog/docs/eval commands согласованы как `1.1.0`; historical evidence не переписана.
- [ ] `PROGRESS.md` содержит точные локальные evidence; branch clean; внешние действия не выполнены без команды.
