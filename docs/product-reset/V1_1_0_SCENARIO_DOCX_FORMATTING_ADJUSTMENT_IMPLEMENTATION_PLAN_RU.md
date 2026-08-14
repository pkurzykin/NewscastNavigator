# NewscastNavigator 1.1.0 — корректировка форматирования DOCX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести шапку экспортируемого DOCX и выравнивание первой рабочей
колонки к утверждённому визуальному образцу без изменения продуктовой модели,
API, snapshot-контракта или in-memory природы экспорта.

**Актуализация 1.1.1:** этот исторический план дополнен утверждённым
`V1_1_1_SCENARIO_DOCX_VISUAL_FIXES_DESIGN_RU.md`. Голубая шапка остаётся только
на первой странице и ни одна строка не получает `w:tblHeader`; `life` выводит
служебный жирный курсивный `Лайф`; `zk_geo` начинает первый абзац с `Гео: `;
последовательные bundles одного непустого файла в «В кадре» выводятся одной
группой.

**Architecture:** Существующий `ScenarioDocxSnapshot` и публичная функция
`render_scenario_docx(snapshot) -> BytesIO` остаются неизменными. Renderer
создаёт две синие metadata-строки вместо трёх: первая содержит два абзаца
названия и рубрики в одной общей ячейке, вторая — хронометраж; затем следует
строка заголовков. `_CellWriter` получает необязательное выравнивание абзацев,
которое применяется только к конкретному writer: `CENTER` для шапки и
`JUSTIFY` для первой рабочей колонки.

**Tech Stack:** Python 3.11, `python-docx 1.2.0`, pytest, LibreOffice render,
Vitest/Vite, Playwright, CodeRabbit CLI.

## Global Constraints

- Утверждённый дизайн: commit `35dd795`, разделы 8.2–8.4 и 12 файла
  `docs/product-reset/V1_1_0_SCENARIO_DOCX_EXPORT_DESIGN_RU.md`.
- Название и рубрика — два последовательных абзаца одной общей синей ячейки;
  между ними нет табличной горизонтальной границы.
- Название, рубрика, хронометраж и три заголовка колонок — жирные и
  центрированы по горизонтали; их ячейки центрированы по вертикали.
- Все непустые абзацы body-колонки «Текст в титре» выравниваются по ширине;
  колонки «В кадре» и «Звук» не получают `JUSTIFY`.
- Run-level font/bold/italic/strike/fill, TipTap paragraphs, hard breaks,
  XML-safe replacement и immutable snapshot не меняются.
- A4, поля, ширина таблицы/колонок, границы, отсутствие fixed row height и
  вертикальное выравнивание body-ячеек сверху сохраняются; `w:tblHeader` не
  ставится ни на одну строку.
- DOCX остаётся чистым in-memory `BytesIO`; runtime не создаёт temp, storage
  или archive files.
- Тесты и render используют только синтетические данные.
- Не выполнять push, PR, merge, tag или deploy.

---

### Task 1: Сгруппировать и выровнять шапку, выровнять первую колонку по ширине

**Files:**
- Modify: `backend/tests/test_scenario_docx_renderer.py:8-290`
- Modify: `backend/tests/test_render_synthetic_scenario_docx.py`
- Modify: `backend/tests/test_scenario_docx_export_api.py`
- Modify: `backend/app/services/scenario_docx_renderer.py:8-469`
- Modify: `backend/scripts/render_synthetic_scenario_docx.py`

**Interfaces:**
- Consumes: `render_scenario_docx(snapshot: ScenarioDocxSnapshot) -> BytesIO`.
- Produces: тот же публичный интерфейс и тот же immutable snapshot contract;
  меняется только OOXML-структура/форматирование таблицы.

- [ ] **Step 1: Написать RED assertions для общей шапки**

Добавить импорт:

```python
from docx.enum.text import WD_ALIGN_PARAGRAPH
```

В `test_renderer_builds_a4_table_layout_and_all_five_block_mappings` заменить
старые ожидания metadata/header/body rows буквальными утверждёнными значениями:

```python
assert len(table.rows) == 8

title_rubric = table.rows[0].cells[0]
assert title_rubric._tc is table.rows[0].cells[1]._tc
assert title_rubric._tc is table.rows[0].cells[2]._tc
assert [paragraph.text for paragraph in title_rubric.paragraphs] == [
    "Синтетический выпуск",
    "Учебная рубрика",
]
assert all(
    paragraph.alignment == WD_ALIGN_PARAGRAPH.CENTER
    for paragraph in title_rubric.paragraphs
)
assert all(run.bold is True for paragraph in title_rubric.paragraphs for run in paragraph.runs)

duration = table.rows[1].cells[0]
assert duration._tc is table.rows[1].cells[1]._tc
assert duration._tc is table.rows[1].cells[2]._tc
assert duration.text == "Хронометраж 12:34"
assert duration.paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
assert all(run.bold is True for run in duration.paragraphs[0].runs)

header = table.rows[2]
assert [cell.text for cell in header.cells] == ["Текст в титре", "В кадре", "Звук"]
assert all(
    cell.paragraphs[0].alignment == WD_ALIGN_PARAGRAPH.CENTER
    for cell in header.cells
)
assert all(run.bold is True for cell in header.cells for run in cell.paragraphs[0].runs)
assert all(
    cell.vertical_alignment == WD_CELL_VERTICAL_ALIGNMENT.CENTER
    for row in table.rows[:3]
    for cell in row.cells
)
```

Сохранить проверки `B6DDE8`, border `w:sz=4` и отсутствия `w:trHeight`.
Структурно проверить отсутствие `w:tblHeader` у каждой строки таблицы.

- [ ] **Step 2: Написать RED assertions для body alignment**

В том же тесте определить `body = table.rows[3:]` и добавить:

```python
assert all(
    paragraph.alignment == WD_ALIGN_PARAGRAPH.JUSTIFY
    for row in body
    for paragraph in _nonempty_paragraphs(row.cells[0])
)
assert all(
    paragraph.alignment != WD_ALIGN_PARAGRAPH.JUSTIFY
    for row in body
    for cell in row.cells[1:]
    for paragraph in _nonempty_paragraphs(cell)
)
assert all(
    cell.vertical_alignment == WD_CELL_VERTICAL_ALIGNMENT.TOP
    for row in body
    for cell in row.cells
)
```

Эти assertions должны ловить три реальные мутации: возврат отдельной строки
рубрики, снятие `bold/center` с шапки и снятие `JUSTIFY` с первой body-колонки.

- [ ] **Step 3: Запустить тест и подтвердить RED**

Run:

```bash
cd backend
.venv/bin/pytest -q \
  tests/test_scenario_docx_renderer.py::test_renderer_builds_a4_table_layout_and_all_five_block_mappings
```

Expected: FAIL на текущих `9` строках и/или отсутствии `CENTER`/`JUSTIFY`;
ошибок импорта и fixture setup нет.

- [ ] **Step 4: Добавить управляемое выравнивание в `_CellWriter`**

В renderer импортировать `WD_ALIGN_PARAGRAPH` и `WD_PARAGRAPH_ALIGNMENT`, затем
изменить writer без воздействия на существующих callers:

```python
class _CellWriter:
    def __init__(
        self,
        cell: _Cell,
        *,
        alignment: WD_PARAGRAPH_ALIGNMENT | None = None,
    ) -> None:
        cell.text = ""
        cell.paragraphs[0].clear()
        self._cell = cell
        self._first = True
        self._alignment = alignment

    def paragraph(self) -> Paragraph:
        if self._first:
            self._first = False
            paragraph = self._cell.paragraphs[0]
        else:
            paragraph = self._cell.add_paragraph()
        paragraph.alignment = self._alignment
        return paragraph
```

Расширить `_write_simple_text` параметром `alignment` и добавить узкий helper
для нескольких жирных абзацев шапки:

```python
def _write_simple_text(
    cell: _Cell,
    text: str,
    *,
    bold: bool = False,
    alignment: WD_PARAGRAPH_ALIGNMENT | None = None,
) -> None:
    writer = _CellWriter(cell, alignment=alignment)
    writer.append_plain(
        text,
        replace(_default_target_style("", "text"), bold=bold),
    )


def _write_header_texts(cell: _Cell, *texts: str) -> None:
    writer = _CellWriter(cell, alignment=WD_ALIGN_PARAGRAPH.CENTER)
    style = replace(_default_target_style("", "text"), bold=True)
    for text in texts:
        writer.append_plain(text, style)
```

- [ ] **Step 5: Реализовать минимальную новую структуру таблицы**

Создать `3 + len(snapshot.rows)` строк. В строке `0` объединить три ячейки и
вызвать `_write_header_texts(cell, snapshot.title, snapshot.rubric_name)`; в
строке `1` объединить три ячейки и записать хронометраж тем же helper. Строка
`2` — существующие три заголовка через `_write_simple_text(..., bold=True,
alignment=WD_ALIGN_PARAGRAPH.CENTER)`. Body начинается с `table.rows[3:]`.

В `_write_body_row` создать только `text_writer` с
`alignment=WD_ALIGN_PARAGRAPH.JUSTIFY`. После заполнения таблицы задать
`WD_CELL_VERTICAL_ALIGNMENT.CENTER` строкам `0..2` и
`WD_CELL_VERTICAL_ALIGNMENT.TOP` только body-строкам.

```python
table = document.add_table(rows=3 + len(snapshot.rows), cols=3)

title_rubric = table.rows[0].cells[0].merge(table.rows[0].cells[2])
_write_header_texts(title_rubric, snapshot.title, snapshot.rubric_name)
_set_cell_shading(title_rubric, "B6DDE8")

duration_text = (
    f"Хронометраж {snapshot.duration_text}"
    if snapshot.duration_text
    else "Хронометраж —"
)
duration = table.rows[1].cells[0].merge(table.rows[1].cells[2])
_write_header_texts(duration, duration_text)
_set_cell_shading(duration, "B6DDE8")

header = table.rows[2]
for cell, text in zip(
    header.cells,
    ("Текст в титре", "В кадре", "Звук"),
    strict=True,
):
    _write_simple_text(
        cell,
        text,
        bold=True,
        alignment=WD_ALIGN_PARAGRAPH.CENTER,
    )
    _set_cell_shading(cell, "B6DDE8")

for table_row, source in zip(table.rows[3:], snapshot.rows, strict=True):
    _write_body_row(table_row, source)

for row in table.rows[:3]:
    for cell in row.cells:
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
for row in table.rows[3:]:
    for cell in row.cells:
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
```

- [ ] **Step 6: Подтвердить GREEN и отсутствие renderer-регрессий**

Run:

```bash
cd backend
.venv/bin/pytest -q tests/test_scenario_docx_renderer.py
.venv/bin/pytest -q \
  tests/test_render_synthetic_scenario_docx.py \
  tests/test_scenario_docx_export_api.py
```

Expected: все тесты PASS; XML-safe, privacy, filename, immutable snapshot,
unsupported block и HTTP export assertions остаются зелёными.

- [ ] **Step 7: Сделать локальный implementation commit**

```bash
git add backend/app/services/scenario_docx_renderer.py \
  backend/tests/test_scenario_docx_renderer.py
git commit -m "fix(export): align DOCX header and body text"
```

---

### Task 2: Обновить документацию и выполнить render/release verification

**Files:**
- Modify: `docs/product-reset/V1_1_0_SCENARIO_DOCX_EXPORT_IMPLEMENTATION_PLAN_RU.md:618-637`
- Modify: `docs/product-reset/PROGRESS.md`
- Modify: `CHANGELOG.md:1-12`
- Create (ignored artifact): `artifacts/product-reset/V1_1_0/docx-export/formatting-adjustment/synthetic-scenario.docx`
- Create (ignored QA): `artifacts/product-reset/V1_1_0/docx-export/formatting-adjustment/rendered/`

**Interfaces:**
- Consumes: committed Task 1 renderer и synthetic helper
  `backend/scripts/render_synthetic_scenario_docx.py`.
- Produces: воспроизводимый синтетический DOCX/render evidence и точную запись
  локальных проверок без внешнего binding.

- [ ] **Step 1: Устранить противоречие старого implementation plan**

В исходном плане заменить требование `three merged metadata rows` на точный
актуальный контракт: две merged metadata rows; первая содержит два жирных
центрированных абзаца title/rubric; вторая — жирный центрированный duration;
header жирный/центрированный; первая body-колонка `JUSTIFY`.

В `CHANGELOG.md` добавить в `1.1.0 / Changed` один пункт:

```markdown
- В DOCX название и рубрика объединены в одну центрированную шапку, а текст
  первой рабочей колонки выровнен по ширине.
```

- [ ] **Step 2: Создать финальный синтетический DOCX**

Run:

```bash
cd backend
.venv/bin/python scripts/render_synthetic_scenario_docx.py \
  --output ../artifacts/product-reset/V1_1_0/docx-export/formatting-adjustment/synthetic-scenario.docx
```

Expected: exit `0`, DOCX существует, `python3 -m zipfile -t` возвращает
`Done testing`.

- [ ] **Step 3: Отрендерить документ bundled runtime**

Run:

```bash
CODEX_DOCUMENTS_PYTHON="${CODEX_DOCUMENTS_PYTHON:-/Users/pavelkurzykin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3}"
CODEX_DOCUMENTS_RENDERER="${CODEX_DOCUMENTS_RENDERER:-/Users/pavelkurzykin/.codex/plugins/cache/openai-primary-runtime/documents/26.805.11740/skills/documents/render_docx.py}"
env TMPDIR=/private/tmp \
  "${CODEX_DOCUMENTS_PYTHON}" \
  "${CODEX_DOCUMENTS_RENDERER}" \
  artifacts/product-reset/V1_1_0/docx-export/formatting-adjustment/synthetic-scenario.docx \
  --output_dir artifacts/product-reset/V1_1_0/docx-export/formatting-adjustment/rendered \
  --emit_pdf
```

Expected: PDF и `page-<N>.png` созданы, число страниц не нулевое.

- [ ] **Step 4: Проверить каждую страницу визуально**

Открыть через `view_image(detail=original)` все `page-<N>.png`, без spot-check.
На первой странице подтвердить общую синюю ячейку title/rubric без внутренней
границы, жирное центрирование шапки и видимое выравнивание длинных абзацев
первой колонки по ширине. На всех страницах проверить отсутствие clipping,
overlap, потерянных borders, пустых случайных страниц и повреждённых rich-text
runs. При любом дефекте вернуться в RED/GREEN Task 1 и повторить полный render.

- [ ] **Step 5: Запустить полный локальный verification set**

Run:

```bash
cd backend
.venv/bin/pytest -q

cd ../frontend
npm test -- --run
npm run build
npx playwright test scenario-docx-export.spec.ts \
  --project=chromium-1366 \
  --project=chromium-1920 \
  --workers=1

cd ..
docker compose --env-file .env.example -f compose.yaml config --quiet
git diff --check
```

Expected: backend/frontend/browser/build/Compose/diff gates exit `0`; известные
warnings записываются отдельно и не объявляются failures.

- [ ] **Step 6: Записать точное evidence в `PROGRESS.md`**

Добавить подраздел про утверждённую 2026-08-07 корректировку. Записать exact
`git rev-parse HEAD`, counts/durations всех команд, SHA-256 DOCX, число
проверенных страниц, structural assertions, отсутствие реальных данных и
оставшиеся warnings/external gates. Не заявлять production binding.

- [ ] **Step 7: Сделать documentation/evidence commit**

```bash
git add CHANGELOG.md \
  docs/product-reset/V1_1_0_SCENARIO_DOCX_EXPORT_IMPLEMENTATION_PLAN_RU.md \
  docs/product-reset/PROGRESS.md
git commit -m "docs(progress): record DOCX formatting verification"
```

- [ ] **Step 8: Выполнить разрешённый committed-diff CodeRabbit review**

Run:

```bash
coderabbit review --agent --committed --base 35dd795 -c AGENTS.md
```

Expected: `0` Critical/Important. Каждый valid finding воспроизводится тестом
до изменения; false-positive получает конкретное file-level обоснование.
Повторный review выполняется только после локального fix-коммита и зелёных
релевантных тестов. Push, PR, merge, tag и deploy не выполняются.
