# NewscastNavigator 1.1.1 — визуальные исправления DOCX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить отображение `life`, `zk_geo`, повторяющихся имён файлов и
голубой шапки в DOCX, затем выпустить и развернуть патч `1.1.1`.

**Architecture:** Публичный renderer и immutable snapshot не меняются.
Внутренние helpers формируют служебные подписи и визуальные группы bundles;
повторяемые заголовки таблицы удаляются. Release metadata обновляется только
после зелёного render-контракта.

**Tech Stack:** Python 3.11, python-docx 1.2, pytest, LibreOffice renderer,
Vitest/Vite, Playwright, CodeRabbit CLI, Docker Compose.

## Global Constraints

- До Task 1 полностью прочитать `SPEC_RU.md`, `EVAL_RUBRIC_RU.md`,
  утверждённый `IMPLEMENTATION_PLAN_RU.md` (если есть), `GOAL_PROMPTS_RU.md`
  и design `V1_1_1_SCENARIO_DOCX_VISUAL_FIXES_DESIGN_RU.md`; затем выполнить
  read-only `/plan` и получить явное file-level утверждение.
- `Лайф` — жирный курсивный служебный абзац, затем текст `life` в первой колонке.
- `Гео: ` — префикс первого абзаца `zk_geo`, значение не переносится в новый абзац.
- Только последовательные одинаковые непустые имена файлов объединяются.
- Имя файла жирное; тайминги и отдельная строка `+` не жирные.
- Голубой блок существует только на первой странице; `w:tblHeader` отсутствует.
- API, schema, migration, snapshot, frontend editor и CaptionPanels не меняются.
- DOCX остаётся in-memory; тесты и render используют только синтетические данные.
- Работа идёт в отдельной ветке или worktree, `main`
  напрямую не меняется.
- После каждого checkpoint запускаются релевантные тесты, полный доступный
  набор и browser-проверка согласно `AGENTS.md`. Для узкого renderer
  checkpoint full/browser допускается оставить единым финальным gate только
  если промежуточные commits являются его ancestors, а финальная delta ими
  покрыта; такое отложение фиксируется как план, а не как выполненная проверка.
- Полный backend и внешние release-gates запускаются по одному разу на финальном committed tree.
- Production backup, merge, push, deploy, smoke и tag разрешены только после
  зелёных gates и отдельной явной команды владельца; тег `v1.1.0` не перемещается.

---

### Task 1: Реализовать визуальный контракт renderer через TDD

**Files:**
- Modify: `backend/tests/test_scenario_docx_renderer.py`
- Modify: `backend/app/services/scenario_docx_renderer.py`

**Interfaces:**
- Consumes: `ScenarioDocxSnapshot`, `ScenarioDocxRow`, `DocxFileBundle`.
- Produces: прежний `render_scenario_docx(snapshot) -> BytesIO`.

- [ ] **Step 1: Написать RED-тесты размещения `life` и `zk_geo`**

Проверить буквальную последовательность первой колонки:

```python
assert [paragraph.text for paragraph in _nonempty_paragraphs(life.cells[0])] == [
    "Лайф",
    "Натуральный синтетический звук",
]
assert life.cells[2].text == ""
assert life.cells[0].paragraphs[0].runs[0].bold is True
assert life.cells[0].paragraphs[0].runs[0].italic is True
assert _nonempty_paragraphs(geo.cells[0])[0].text == "Гео: Синтетический регион"
```

Run из `backend/`:

```bash
.venv/bin/pytest -q tests/test_scenario_docx_renderer.py \
  -k "life or geo"
```

Expected: FAIL на текущем размещении `life` в «Звук» и отсутствии `Гео: `.

- [ ] **Step 2: Написать RED-тест file grouping**

Fixture должна содержать подряд два bundles `synthetic-file.mov`, затем
`synthetic-cutaway.mov`, затем снова `synthetic-file.mov`, а также bundle без
имени. Проверить:

```text
synthetic-file.mov\n00:10–00:38\n+\n01:02–01:35
synthetic-cutaway.mov\n01:40–01:45
synthetic-file.mov\n01:50–01:55
02:00–02:05
```

У первой строки каждой именованной группы `bold=True`; runs таймингов и `+`
имеют `bold is False`. Одинаковое имя после другого файла не объединяется.

Run:

```bash
.venv/bin/pytest -q tests/test_scenario_docx_renderer.py \
  -k "file_bundle"
```

Expected: FAIL из-за четырёх отдельных групп и обычного имени файла.

- [ ] **Step 3: Написать RED-тест шапки только на первой странице**

Заменить старое ожидание repeat-header:

```python
assert all(
    row._tr.get_or_add_trPr().find(qn("w:tblHeader")) is None
    for row in table.rows
)
```

Run:

```bash
.venv/bin/pytest -q \
  tests/test_scenario_docx_renderer.py::test_renderer_builds_a4_table_layout_and_all_five_block_mappings
```

Expected: FAIL, потому что строки `0..2` сейчас содержат `w:tblHeader`.

- [ ] **Step 4: Реализовать минимальный GREEN**

В `_write_body_row`:

- писать label и текст `life` через `text_writer`;
- добавлять `Гео: ` к первому geo paragraph без потери его runs;
- собирать последовательные bundles одного непустого имени в одну группу;
- задавать `bold=True` только run имени файла;
- писать обычные runs диапазонов и `+` с hard breaks;
- не вызывать `_set_repeat_table_header` и удалить неиспользуемый helper.

- [ ] **Step 5: Подтвердить GREEN и регрессии renderer**

```bash
.venv/bin/pytest -q tests/test_scenario_docx_renderer.py
.venv/bin/pytest -q \
  tests/test_scenario_docx_snapshot.py \
  tests/test_scenario_docx_export_api.py \
  tests/test_render_synthetic_scenario_docx.py
```

Expected: все тесты PASS; privacy, XML-safe, immutable snapshot и API не
регрессируют.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/scenario_docx_renderer.py \
  backend/tests/test_scenario_docx_renderer.py
git commit -m "fix(export): refine DOCX production layout"
```

Focused renderer gates выполняются сразу в Steps 1–5. Полный доступный
backend/frontend/browser набор намеренно объединён в Task 3 final gate на
descendant exact tree; это узкое исключение допустимо только при ancestor
intermediate commits и покрытой ими final delta, без утверждения о промежуточном
full/browser pass.

---

### Task 2: Обновить синтетический render-контракт и release metadata

**Files:**
- Modify: `backend/tests/test_render_synthetic_scenario_docx.py`
- Modify: `backend/scripts/render_synthetic_scenario_docx.py`
- Modify: `docs/product-reset/V1_1_0_SCENARIO_DOCX_EXPORT_DESIGN_RU.md`
- Modify: `docs/product-reset/V1_1_0_SCENARIO_DOCX_FORMATTING_ADJUSTMENT_IMPLEMENTATION_PLAN_RU.md`
- Modify: `docs/product-reset/PROGRESS.md`
- Modify: `CHANGELOG.md`
- Modify: `backend/pyproject.toml`
- Modify: `backend/app/core/version.py`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/components/AppFooter.test.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.test.tsx`

**Interfaces:**
- Consumes: committed renderer Task 1.
- Produces: синтетический 2–3 page DOCX и согласованную версию `1.1.1`.

- [ ] **Step 1: Написать RED render assertions**

Fixture должна содержать markers `Лайф`, `Гео: СИНТЕТИЧЕСКИЙ РЕГИОН`, одну
группу одинакового `synthetic-file.mov` с двумя диапазонами и один другой
файл. Уменьшить будущий объём фикстуры до достаточного для 2–3 страниц, но
до GREEN не менять generator.

Run:

```bash
.venv/bin/pytest -q tests/test_render_synthetic_scenario_docx.py
```

Expected: FAIL на новых markers/grouping.

- [ ] **Step 2: Обновить synthetic generator и подтвердить GREEN**

Использовать только вымышленные данные. Сохранить natural-wrap paragraph,
пять типов блоков, разрешённые шрифты/заливки, immutable snapshot и минимум
две страницы при реальном render.

```bash
.venv/bin/pytest -q tests/test_render_synthetic_scenario_docx.py
```

- [ ] **Step 3: Выполнить render и просмотреть все страницы**

Создать ignored DOCX в
`artifacts/product-reset/V1_1_1/docx-export/synthetic-scenario.docx`, проверить
ZIP, отрендерить packaged `render_docx.py` с `TMPDIR=/private/tmp`, открыть все
`page-<N>.png` через `view_image(detail=original)`.

Подтвердить: шапка только на page 1; `Лайф`/geo/file grouping правильны; нет
clipping, overlap, потерянных границ или пустых страниц.

- [ ] **Step 4: Обновить актуальную документацию и версии через RED/GREEN**

Сначала заменить version expectations тестов на `1.1.1` и запустить их до
изменения metadata. Затем обновить backend/frontend version metadata,
Changelog, фактический DOCX-контракт старых документов и `PROGRESS.md`.

```bash
cd frontend
npm test -- --run src/components/AppFooter.test.tsx \
  src/components/app-shell/AppShell.test.tsx
```

Expected RED до metadata; PASS после metadata.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/render_synthetic_scenario_docx.py \
  backend/tests/test_render_synthetic_scenario_docx.py \
  backend/pyproject.toml backend/app/core/version.py \
  frontend/package.json frontend/package-lock.json \
  frontend/src/components/AppFooter.test.tsx \
  frontend/src/components/app-shell/AppShell.test.tsx \
  CHANGELOG.md docs/product-reset
git commit -m "chore(release): prepare NewscastNavigator 1.1.1"
```

Focused render/version gates выполняются сразу в Steps 1–4. Полный доступный
backend/frontend/browser набор остаётся Task 3 final gate на descendant exact
tree при тех же ancestor/delta условиях; промежуточный full/browser pass не
заявляется.

---

### Task 3: Финальные gates, review и release

**Files:**
- Modify: `docs/product-reset/PROGRESS.md` только для точных результатов.
- Create ignored: `.superpowers/sdd/V1_1_1_SCENARIO_DOCX_VISUAL_FIXES_IMPLEMENTATION_PLAN_RU/`

- [ ] **Step 1: Один полный локальный verification set**

```bash
cd backend
.venv/bin/pytest -q
cd ../frontend
npm ci
npm test -- --run
npm run build
npx playwright test scenario-docx-export.spec.ts \
  --project=chromium-1366 --project=chromium-1920 --workers=1
cd ..
docker compose --env-file .env.example -f compose.yaml config --quiet
git diff --check
```

- [ ] **Step 2: Зафиксировать evidence commit до final exact-tree reviews**

После локальных gates записать точные результаты в `PROGRESS.md` и создать
evidence commit. После любого docs/review fix запускать affected tests/docs/diff
и повторять whole-branch/CodeRabbit review на новом exact HEAD.

- [ ] **Step 3: Reviews на final exact HEAD**

Выполнить task reviews, whole-branch review и один CodeRabbit committed-diff
review относительно исходного `main`. Critical/Important/Major должны быть
закрыты до интеграции.

- [ ] **Step 4: Интегрировать и развернуть**

Только после зелёных gates и отдельной явной команды владельца продукта:
fast-forward merge в `main`, push, зелёный GitHub CI exact выпускаемого SHA,
predeploy backup,
deploy exact SHA, public/authenticated/CaptionPanels/DOCX smoke и visual check
production DOCX. При ошибке вернуть зафиксированный predeploy SHA.

- [ ] **Step 5: Создать release binding**

Только после зелёного smoke и отдельной явной команды владельца создать и push
аннотированный `v1.1.1`, записать production evidence отдельным
documentation-only commit и повторно проверить чистый `main`/`origin/main`.
