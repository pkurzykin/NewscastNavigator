# Semantic History and Hidden Technical Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать технические номера автосохранений из повседневного интерфейса и заменить сырой JSON истории человекочитаемым diff всех видимых полей таблицы сценария.

**Architecture:** Серверные `revision`, `from_revision` и `to_revision` остаются без изменений как optimistic-concurrency и audit anchors. Frontend вводит чистую allowlist-проекцию raw snapshot → semantic fields и рендерит только её; неизвестные внутренние поля fail-closed не попадают в UI. Пользовательские workflow, уведомления, карточки истории и восстановление используют рабочие формулировки без версии документа.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, React 18, TypeScript 5.6, Vitest, Testing Library, Playwright, CSS.

## Global Constraints

- Выполнять план только в `/Volumes/work/Projects/NewscastNavigator-product-reset` на ветке `feat/product-reset`.
- Не создавать новый worktree, параллельный v2-контур или новый пользовательский режим.
- Один сюжет по-прежнему имеет один актуальный сценарий; ручные версии, branch/merge и выбор текущего текста запрещены.
- Серверная ревизия остаётся внутренней защитой от конфликтов и точной привязкой workflow, read markers, CaptionPanels, production, diff и restore.
- Номера сохранённых состояний допустимы только вторичным текстом внутри уже открытого подробного diff.
- UI никогда не выводит raw `structured_data`, `formatting`, `rich_text`, `schema_version`, `targets`, `segment_uid` или неизвестные внутренние поля.
- История показывает все видимые поля таблицы: тип блока, гео, ФИО, должность, текст, визуальное форматирование, файлы/таймкоды и «В кадре».
- Каждое изменение начинается с RED-теста; после каждого checkpoint запускаются component-, полный доступный и browser-наборы.
- Вести `docs/product-reset/PROGRESS.md`, выполнять CodeRabbit review staged diff и создавать небольшие локальные commits.
- Не выполнять push, PR, merge, deploy или обновление external demo evidence без отдельной команды владельца.

---

## File Map

### Создаётся

- `frontend/src/features/history/semanticScenarioDiff.ts` — единственная allowlist-проекция технических snapshot в пользовательские поля.
- `frontend/src/features/history/semanticScenarioDiff.test.ts` — чистые тесты проекции, включая unknown-field и formatting-only cases.

### Изменяются

- `backend/app/api/routes/history.py` — нейтральный confirmation text восстановления без «новой редакции».
- `backend/tests/test_story_history_api.py` — contract пользовательской формулировки restore action.
- `frontend/src/features/workflow/components/WorkflowSummary.tsx` — actor/time без номера редакции.
- `frontend/src/features/workflow/WorkflowActions.test.tsx` — сохраняет workflow semantics и запрещает видимый номер.
- `frontend/src/features/notifications/components/NotificationTray.tsx` — summary количества изменений без диапазона редакций.
- `frontend/src/features/notifications/AttentionQueue.test.tsx` — запрещает номер в notification diff.
- `frontend/src/features/history/types.ts` — типизирует raw snapshot и semantic projection без изменения API contract.
- `frontend/src/features/history/components/HistoryTimeline.tsx` — убирает номера из карточек сеансов.
- `frontend/src/features/history/components/RestoreScenarioDialog.tsx` — «Восстановить состояние» без version-control copy.
- `frontend/src/features/history/components/ScenarioSessionDiff.tsx` — semantic renderer вместо `JSON.stringify`.
- `frontend/src/features/history/HistoryTimeline.test.tsx` — новый UI contract истории и restore.
- `frontend/src/styles/history.css` — компактный layout semantic values и вторичного state range.
- `frontend/e2e/production-workflow.spec.ts` — workflow marks без `редакция N`.
- `frontend/e2e/notification-routing.spec.ts` — notification diff без диапазона.
- `frontend/e2e/story-history.spec.ts` — timeline, semantic diff, formatting, restore и direct-session URL.
- `docs/product-reset/SPEC_RU.md` — явно закрепляет отсутствие autosave counters и raw JSON в UI.
- `docs/product-reset/PROGRESS.md` — RED/GREEN, review, tests, commits и оставшиеся риски.

### Намеренно не меняются

- `backend/app/db/models/scenario.py`, `backend/app/services/scenario_service.py`, `backend/app/services/scenario_history.py` — ревизии, snapshots, pruning и append-only restore остаются прежними.
- `backend/app/schemas/history.py`, `frontend/src/features/history/api.ts` — wire contract сохраняет raw snapshots и revision anchors.
- `frontend/src/features/scenario/useScenarioAutosave.ts`, `frontend/src/features/workflow/api.ts`, `frontend/src/features/production/api.ts` — команды продолжают передавать точную текущую ревизию.

---

### Task 1: Скрыть технические номера и исправить restore copy

**Files:**
- Modify: `backend/app/api/routes/history.py:89-102`
- Modify: `backend/tests/test_story_history_api.py:210-235`
- Modify: `frontend/src/features/workflow/components/WorkflowSummary.tsx:1-32`
- Modify: `frontend/src/features/workflow/WorkflowActions.test.tsx:140-151`
- Modify: `frontend/src/features/notifications/components/NotificationTray.tsx:23-38`
- Modify: `frontend/src/features/notifications/AttentionQueue.test.tsx:214-266`
- Modify: `frontend/src/features/history/components/HistoryTimeline.tsx:43-66`
- Modify: `frontend/src/features/history/components/RestoreScenarioDialog.tsx:68-88`
- Modify: `frontend/src/features/history/HistoryTimeline.test.tsx`

**Interfaces:**
- Consumes: существующие `WorkflowMark.revision`, `InternalNotification.diff.from_revision/to_revision` и `EditSessionHistoryItem.from_revision/to_revision`.
- Produces: неизменные API/types; меняется только пользовательский текст. `ScenarioSessionDiff` продолжит получать revision anchors для Task 3.

- [ ] **Step 1: Записать RED backend contract для restore copy**

В `backend/tests/test_story_history_api.py` рядом с проверкой
`restore_scenario_session` добавить:

```python
restore_action = item["available_actions"][0]
assert restore_action["label"] == "Восстановить"
assert restore_action["confirmation"] == (
    "Выбранное состояние станет актуальным. Последующая история сохранится."
)
assert "редакц" not in restore_action["confirmation"].lower()
```

- [ ] **Step 2: Запустить backend RED**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_story_history_api.py
```

Expected: FAIL, потому что confirmation ещё содержит «новую актуальную редакцию».

- [ ] **Step 3: Записать RED component contracts**

В `WorkflowActions.test.tsx` заменить assertion номера на:

```tsx
const summary = screen.getByRole("region", {
  name: "Редакционная проверка и корректура",
});
expect(summary).toHaveTextContent("Астра");
expect(summary).toHaveTextContent("15.07.2026");
expect(summary).not.toHaveTextContent(/редакци(?:я|и)\s+\d/i);
```

В `AttentionQueue.test.tsx` для открытого `NotificationTray`:

```tsx
expect(within(tray).getByText("Изменений: 2")).toBeInTheDocument();
expect(within(tray).queryByText(/Редакции\s+\d+\s+→\s+\d+/i))
  .not.toBeInTheDocument();
```

В `HistoryTimeline.test.tsx` закрепить:

```tsx
expect(screen.queryByText(/Редакции\s+\d+\s+→\s+\d+/i))
  .not.toBeInTheDocument();

await user.click(screen.getByRole("button", { name: "Восстановить" }));
const dialog = screen.getByRole("dialog", { name: "Восстановить состояние сценария" });
expect(within(dialog).queryByText(/редакци/i)).not.toBeInTheDocument();
expect(within(dialog).getByRole("button", { name: "Восстановить состояние" }))
  .toHaveFocus();
```

- [ ] **Step 4: Запустить frontend RED**

Run:

```bash
cd frontend
npm test -- --run \
  src/features/workflow/WorkflowActions.test.tsx \
  src/features/notifications/AttentionQueue.test.tsx \
  src/features/history/HistoryTimeline.test.tsx
```

Expected: FAIL на текущих строках `редакция 6`, `Редакции 4 → 7`,
timeline range и кнопке «Создать новую актуальную редакцию».

- [ ] **Step 5: Реализовать минимальные пользовательские формулировки**

В `WorkflowSummary.tsx` сохранить actor/time, но не revision:

```tsx
function markText(mark: WorkflowMark | null): string {
  if (!mark) return "Не отмечено";
  const at = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(mark.at));
  return `${mark.actor.display_name}, ${at}`;
}
```

В `NotificationTray.tsx` заменить meta:

```tsx
<p className="notification-diff-meta">
  Изменений: {item.diff.summary.total}
</p>
```

В `HistoryTimeline.tsx` удалить `.history-revisions`; actor, position, time и
semantic summary остаются.

В `RestoreScenarioDialog.tsx` удалить диапазон и использовать:

```tsx
<h3 id="history-restore-title">Восстановить состояние сценария</h3>
<p>{action.confirmation
  ?? "Выбранное состояние станет актуальным. Последующая история сохранится."}</p>
<p className="muted">Текущая и последующая история останутся доступны.</p>
```

Кнопка:

```tsx
{submitting ? "Восстановление..." : "Восстановить состояние"}
```

В `backend/app/api/routes/history.py` установить тот же confirmation:

```python
"confirmation": (
    "Выбранное состояние станет актуальным. "
    "Последующая история сохранится."
),
```

- [ ] **Step 6: Запустить targeted GREEN**

Run:

```bash
cd backend
./.venv/bin/pytest -q tests/test_story_history_api.py
cd ../frontend
npm test -- --run \
  src/features/workflow/WorkflowActions.test.tsx \
  src/features/notifications/AttentionQueue.test.tsx \
  src/features/history/HistoryTimeline.test.tsx
```

Expected: все targeted tests PASS; API всё ещё содержит numeric revision fields,
но UI их не показывает.

- [ ] **Step 7: CodeRabbit review и локальный commit**

Run:

```bash
git add \
  backend/app/api/routes/history.py \
  backend/tests/test_story_history_api.py \
  frontend/src/features/workflow/components/WorkflowSummary.tsx \
  frontend/src/features/workflow/WorkflowActions.test.tsx \
  frontend/src/features/notifications/components/NotificationTray.tsx \
  frontend/src/features/notifications/AttentionQueue.test.tsx \
  frontend/src/features/history/components/HistoryTimeline.tsx \
  frontend/src/features/history/components/RestoreScenarioDialog.tsx \
  frontend/src/features/history/HistoryTimeline.test.tsx
coderabbit review --agent -t uncommitted -c AGENTS.md
git diff --cached --check
git commit -m "fix(history): hide technical revision numbers"
```

Expected: все валидные findings закрыты до commit; commit содержит только Task 1.

---

### Task 2: Ввести чистую semantic projection

**Files:**
- Create: `frontend/src/features/history/semanticScenarioDiff.ts`
- Create: `frontend/src/features/history/semanticScenarioDiff.test.ts`
- Modify: `frontend/src/features/history/types.ts:35-63`

**Interfaces:**
- Consumes: `ScenarioRowDiff.before/after`, raw `structured_data`,
  `formatting.targets` и `rich_text.targets`.
- Produces:

```ts
export type SemanticFieldKey =
  | "block_type"
  | "geo"
  | "speaker_fio"
  | "speaker_position"
  | "text"
  | "file_bundle"
  | "additional_comment";

export interface SemanticValue {
  text: string;
  formatting?: ScenarioFormattingTarget;
}

export interface SemanticFieldDiff {
  key: SemanticFieldKey;
  label: string;
  before: SemanticValue | null;
  after: SemanticValue | null;
}

export interface SemanticRowDiff {
  segment_uid: string;
  kind: ScenarioRowDiff["kind"];
  moved: boolean;
  before_order: number | null;
  after_order: number | null;
  fields: SemanticFieldDiff[];
}

export function buildSemanticScenarioDiff(
  changes: ScenarioRowDiff[],
): SemanticRowDiff[];
```

- [ ] **Step 1: Типизировать полный raw snapshot без ослабления API**

В `history/types.ts` добавить явные optional fields:

```ts
export interface ScenarioRowSnapshot {
  order_index?: number;
  block_type?: string;
  text?: string;
  speaker_text?: string;
  file_name?: string;
  tc_in?: string;
  tc_out?: string;
  additional_comment?: string;
  structured_data?: Record<string, unknown>;
  formatting?: {
    targets?: Record<string, ScenarioFormattingTarget>;
  };
  rich_text?: {
    schema_version?: number;
    targets?: Record<string, Partial<EditorCoreRichTextTarget>>;
  };
  [key: string]: unknown;
}
```

Импортировать `EditorCoreRichTextTarget` и `ScenarioFormattingTarget` только как
types. Index signature оставить для forward-compatible raw payload; allowlist
проекции будет решать, что видно пользователю.

- [ ] **Step 2: Записать RED pure tests для всех semantic fields**

В новом `semanticScenarioDiff.test.ts` создать один changed snapshot с:

```ts
const before = {
  order_index: 1,
  block_type: "zk_geo",
  text: "Старый текст",
  speaker_text: "",
  file_name: "before.mov",
  tc_in: "00:01",
  tc_out: "00:05",
  additional_comment: "Старый план",
  structured_data: {
    geo: "Староград",
    file_bundles: [
      { file_name: "before.mov", tc_in: "00:01", tc_out: "00:05" },
    ],
    internal_probe: { secret: "не показывать" },
  },
  formatting: { targets: { text: { bold: false } } },
  rich_text: {
    schema_version: 1,
    targets: {
      geo: { text: "Староград", html: "<em>Староград</em>" },
      text: { text: "Старый текст", html: "Старый текст" },
    },
  },
  unknown_server_field: { raw: true },
};
```

После вызова `buildSemanticScenarioDiff` проверить точный порядок ключей:

```ts
expect(result[0].fields.map((field) => field.key)).toEqual([
  "geo",
  "text",
  "file_bundle",
  "additional_comment",
]);
expect(result[0].fields.find((field) => field.key === "file_bundle")?.before?.text)
  .toBe("before.mov · 00:01–00:05");
expect(JSON.stringify(result)).not.toContain("internal_probe");
expect(JSON.stringify(result)).not.toContain("unknown_server_field");
```

Отдельными tests закрепить следующие exact cases.

СНХ:

```ts
const [snh] = buildSemanticScenarioDiff([{
  segment_uid: "seg_snh",
  kind: "changed",
  moved: false,
  changed_fields: ["speaker_text"],
  before: { block_type: "snh", speaker_text: "Старое имя\nСтарая должность" },
  after: { block_type: "snh", speaker_text: "Новое имя\nНовая должность" },
}]);
expect(snh.fields.map((field) => field.key)).toEqual([
  "speaker_fio",
  "speaker_position",
]);
```

Только форматирование:

```ts
const [formatted] = buildSemanticScenarioDiff([{
  segment_uid: "seg_format",
  kind: "changed",
  moved: false,
  changed_fields: ["formatting"],
  before: {
    block_type: "zk",
    text: "Одинаковый текст",
    formatting: { targets: { text: { bold: false } } },
  },
  after: {
    block_type: "zk",
    text: "Одинаковый текст",
    formatting: { targets: { text: { bold: true } } },
  },
}]);
expect(formatted.fields.map((field) => field.key)).toEqual(["text"]);
expect(formatted.fields[0].before?.formatting?.bold).toBe(false);
expect(formatted.fields[0].after?.formatting?.bold).toBe(true);
```

Добавление, удаление и перемещение:

```ts
const semantic = buildSemanticScenarioDiff([
  {
    segment_uid: "seg_added",
    kind: "added",
    moved: false,
    changed_fields: [],
    before: null,
    after: { order_index: 2, block_type: "zk", text: "Добавлено" },
  },
  {
    segment_uid: "seg_removed",
    kind: "removed",
    moved: false,
    changed_fields: [],
    before: { order_index: 4, block_type: "life", text: "Удалено" },
    after: null,
  },
  {
    segment_uid: "seg_moved",
    kind: "moved",
    moved: true,
    changed_fields: [],
    before: { order_index: 1, block_type: "zk", text: "Без правки" },
    after: { order_index: 3, block_type: "zk", text: "Без правки" },
  },
]);
expect(semantic.map((change) => change.kind)).toEqual([
  "added",
  "removed",
  "moved",
]);
expect(semantic[0].fields.map((field) => field.key)).toEqual([
  "block_type",
  "text",
]);
expect(semantic[2].fields).toEqual([]);
expect([semantic[2].before_order, semantic[2].after_order]).toEqual([1, 3]);
```

Неизвестное поле:

```ts
const technicalOnly = buildSemanticScenarioDiff([{
  segment_uid: "seg_unknown",
  kind: "changed",
  moved: false,
  changed_fields: ["unknown_server_field"],
  before: { block_type: "zk", text: "Без изменений", unknown_server_field: 1 },
  after: { block_type: "zk", text: "Без изменений", unknown_server_field: 2 },
}]);
expect(technicalOnly).toEqual([]);
```

Tests используют конкретные before/after values и exact expected fields, а не
snapshot всего результата.

- [ ] **Step 3: Запустить pure RED**

Run:

```bash
cd frontend
npm test -- --run src/features/history/semanticScenarioDiff.test.ts
```

Expected: FAIL, module/function ещё не существуют.

- [ ] **Step 4: Реализовать allowlist projection**

В `semanticScenarioDiff.ts` определить единственный порядок полей:

```ts
const FIELD_ORDER: Array<{ key: SemanticFieldKey; label: string }> = [
  { key: "block_type", label: "Тип блока" },
  { key: "geo", label: "Гео" },
  { key: "speaker_fio", label: "ФИО" },
  { key: "speaker_position", label: "Должность" },
  { key: "text", label: "Текст" },
  { key: "file_bundle", label: "Имя файла / TC" },
  { key: "additional_comment", label: "В кадре" },
];

const BLOCK_LABELS: Record<string, string> = {
  podvodka: "Подводка",
  zk: "ЗК",
  zk_geo: "ЗК+гео",
  life: "Лайф",
  snh: "СНХ",
};
```

Использовать только safe record guards:

```ts
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
```

Текстовые target извлекать без raw HTML:

```ts
function targetText(snapshot: ScenarioRowSnapshot, target: string): string {
  const richText = asRecord(snapshot.rich_text);
  const targets = asRecord(richText.targets);
  return asText(asRecord(targets[target]).text);
}
```

Fallback rules:

```ts
// geo
targetText(snapshot, "geo") || asText(asRecord(snapshot.structured_data).geo)

// speaker
const [fallbackFio = "", fallbackPosition = ""] =
  asText(snapshot.speaker_text).split(/\r?\n/, 2);

// main text
targetText(snapshot, "text") || asText(snapshot.text)
```

Неизвестный `block_type` показывать как «Неизвестный тип», а не выводить raw
code. Семантические значения одной строки собирать только так:

```ts
function semanticValues(
  snapshot: ScenarioRowSnapshot | null,
): Record<SemanticFieldKey, SemanticValue | null> {
  if (!snapshot) {
    return Object.fromEntries(
      FIELD_ORDER.map(({ key }) => [key, null]),
    ) as Record<SemanticFieldKey, null>;
  }

  const structured = asRecord(snapshot.structured_data);
  const [fallbackFio = "", fallbackPosition = ""] =
    asText(snapshot.speaker_text).split(/\r?\n/, 2);

  return {
    block_type: valueOf(
      BLOCK_LABELS[asText(snapshot.block_type)] || "Неизвестный тип",
    ),
    geo: valueOf(
      targetText(snapshot, "geo") || asText(structured.geo),
      formattingFor(snapshot, "geo"),
    ),
    speaker_fio: valueOf(
      targetText(snapshot, "speaker_fio") || fallbackFio,
      formattingFor(snapshot, "speaker_fio"),
    ),
    speaker_position: valueOf(
      targetText(snapshot, "speaker_position") || fallbackPosition,
      formattingFor(snapshot, "speaker_position"),
    ),
    text: valueOf(
      targetText(snapshot, "text") || asText(snapshot.text),
      formattingFor(snapshot, "text"),
    ),
    file_bundle: valueOf(fileBundleText(snapshot)),
    additional_comment: valueOf(asText(snapshot.additional_comment)),
  };
}
```

`valueOf` возвращает `null` для пустого текста. `formattingFor` объединяет
видимые defaults редактора с известными explicit overrides:

```ts
function formattingFor(
  snapshot: ScenarioRowSnapshot,
  target: "geo" | "speaker_fio" | "speaker_position" | "text",
): ScenarioFormattingTarget {
  const blockType = asText(snapshot.block_type);
  const explicit = asRecord(
    asRecord(asRecord(snapshot.formatting).targets)[target],
  );
  return {
    font_family: asText(explicit.font_family) || "PT Sans",
    bold: typeof explicit.bold === "boolean"
      ? explicit.bold
      : blockType === "snh" && target !== "text",
    italic: typeof explicit.italic === "boolean"
      ? explicit.italic
      : blockType === "life"
        || (blockType === "zk_geo" && target === "geo")
        || blockType === "snh",
    strikethrough: explicit.strikethrough === true,
    fill_color: asText(explicit.fill_color) || "#ffffff",
  };
}
```

Файлы нормализовать из `structured_data.file_bundles`; если массива нет,
использовать legacy `file_name/tc_in/tc_out`. Каждая строка:

```ts
[fileName, [tcIn, tcOut].filter(Boolean).join("–")]
  .filter(Boolean)
  .join(" · ")
```

Полная функция не передаёт raw objects дальше:

```ts
function fileBundleText(snapshot: ScenarioRowSnapshot): string {
  const structured = asRecord(snapshot.structured_data);
  const rawBundles = Array.isArray(structured.file_bundles)
    ? structured.file_bundles
    : [{
        file_name: snapshot.file_name,
        tc_in: snapshot.tc_in,
        tc_out: snapshot.tc_out,
      }];

  return rawBundles.flatMap((raw) => {
    const bundle = asRecord(raw);
    const fileName = asText(bundle.file_name);
    const tcIn = asText(bundle.tc_in);
    const tcOut = asText(bundle.tc_out);
    const timecode = [tcIn, tcOut].filter(Boolean).join("–");
    const line = [fileName, timecode].filter(Boolean).join(" · ");
    return line ? [line] : [];
  }).join("\n");
}
```

Несколько bundles объединяются `\n`; пустые bundles не выводятся.

Сравнивать semantic values по `text` и известным formatting keys:
`font_family`, `bold`, `italic`, `strikethrough`, `fill_color`. Для этого
использовать отдельный `sameValue`, который сравнивает только эти свойства, а
не сериализует raw snapshot:

```ts
function sameValue(
  before: SemanticValue | null,
  after: SemanticValue | null,
): boolean {
  return before?.text === after?.text
    && before?.formatting?.font_family === after?.formatting?.font_family
    && before?.formatting?.bold === after?.formatting?.bold
    && before?.formatting?.italic === after?.formatting?.italic
    && before?.formatting?.strikethrough === after?.formatting?.strikethrough
    && before?.formatting?.fill_color === after?.formatting?.fill_color;
}
```

`buildFields(before, after)` получает обе allowlist-проекции, идёт только по
`FIELD_ORDER` и возвращает поле, только если `sameValue` вернул `false`.

`buildSemanticScenarioDiff` должен:

```ts
return changes
  .map((change) => ({
    segment_uid: change.segment_uid,
    kind: change.kind,
    moved: change.moved,
    before_order: change.before?.order_index ?? null,
    after_order: change.after?.order_index ?? null,
    fields: buildFields(change.before, change.after),
  }))
  .filter((change) => change.moved || change.fields.length > 0);
```

Не читать `change.changed_fields` для отображения: raw список может содержать
только `rich_text`/`formatting`, а semantic projection сама определяет видимое
изменение.

- [ ] **Step 5: Запустить pure GREEN и typecheck**

Run:

```bash
cd frontend
npm test -- --run src/features/history/semanticScenarioDiff.test.ts
npx tsc -b --pretty false
```

Expected: pure tests PASS; TypeScript exit `0`.

- [ ] **Step 6: CodeRabbit review и локальный commit**

Run:

```bash
git add \
  frontend/src/features/history/types.ts \
  frontend/src/features/history/semanticScenarioDiff.ts \
  frontend/src/features/history/semanticScenarioDiff.test.ts
coderabbit review --agent -t uncommitted -c AGENTS.md
git diff --cached --check
git commit -m "feat(history): derive semantic scenario changes"
```

Expected: mapper independently reviewed and committed before UI integration.

---

### Task 3: Отрисовать semantic diff и закрепить browser contract

**Files:**
- Modify: `frontend/src/features/history/components/ScenarioSessionDiff.tsx`
- Modify: `frontend/src/features/history/HistoryTimeline.test.tsx`
- Modify: `frontend/src/styles/history.css`
- Modify: `frontend/e2e/production-workflow.spec.ts`
- Modify: `frontend/e2e/notification-routing.spec.ts`
- Modify: `frontend/e2e/story-history.spec.ts`

**Interfaces:**
- Consumes: `buildSemanticScenarioDiff(changes)` и типы Task 2.
- Produces: открытый diff с semantic rows; единственное видимое место numeric
  anchors — `Сохранённые состояния X → Y`.

- [ ] **Step 1: Заменить старые component assertions на RED semantic contract**

В `HistoryTimeline.test.tsx` удалить тест, который требует labels
«Структурированные данные», «Форматирование», «Расширенный текст».

Для тех же raw before/after snapshots проверить:

```tsx
expect(screen.getByText("Гео")).toBeInTheDocument();
expect(screen.getByText("Староград")).toBeInTheDocument();
expect(screen.getByText("Новоград")).toBeInTheDocument();
expect(screen.getByText("Имя файла / TC")).toBeInTheDocument();
expect(screen.getByText("before.mov · 00:01–00:05")).toBeInTheDocument();
expect(screen.getByText("after.mov · 00:06–00:12")).toBeInTheDocument();

for (const forbidden of [
  "Структурированные данные",
  "Форматирование",
  "Расширенный текст",
  "schema_version",
  "targets",
]) {
  expect(screen.queryByText(new RegExp(forbidden, "i"))).not.toBeInTheDocument();
}
```

Для formatting-only change:

```tsx
const beforeText = screen.getByText("Одинаковый текст", { selector: "[data-side='before']" });
const afterText = screen.getByText("Одинаковый текст", { selector: "[data-side='after']" });
expect(beforeText).not.toHaveStyle({ fontWeight: "700" });
expect(afterText).toHaveStyle({ fontWeight: "700" });
```

И отдельно:

```tsx
expect(screen.getByText("Сохранённые состояния 5 → 6")).toBeInTheDocument();
```

- [ ] **Step 2: Запустить renderer RED**

Run:

```bash
cd frontend
npm test -- --run src/features/history/HistoryTimeline.test.tsx
```

Expected: FAIL, текущий renderer ещё использует `JSON.stringify` и raw labels.

- [ ] **Step 3: Реализовать semantic renderer**

В `ScenarioSessionDiff.tsx` удалить `fieldLabels`, `snapshotFields` и
`formatSnapshotValue`. Получить:

```tsx
const changes = buildSemanticScenarioDiff(diff.changes);
```

Если `changes.length === 0`, вернуть существующее:

```tsx
<p className="muted history-diff-empty">Содержательных изменений нет.</p>
```

Header открытого diff:

```tsx
<div className="history-diff-head">
  <h4>Изменения сценария</h4>
  <span className="history-diff-state-range">
    Сохранённые состояния {diff.session.from_revision} → {diff.session.to_revision}
  </span>
</div>
```

Safe style строить только из известных formatting tokens и значений:

```tsx
const allowedFonts = new Set<string>(FONT_OPTIONS);
const allowedFillColors = new Set<string>(
  FILL_COLOR_OPTIONS.map((option) => option.value),
);

function valueStyle(value: SemanticValue | null): CSSProperties {
  const formatting = value?.formatting;
  return {
    fontFamily: formatting?.font_family
      && allowedFonts.has(formatting.font_family)
      ? formatting.font_family
      : undefined,
    fontWeight: formatting?.bold ? 700 : undefined,
    fontStyle: formatting?.italic ? "italic" : undefined,
    textDecoration: formatting?.strikethrough ? "line-through" : undefined,
    backgroundColor: formatting?.fill_color
      && allowedFillColors.has(formatting.fill_color)
      ? formatting.fill_color
      : undefined,
  };
}
```

Импортировать `FONT_OPTIONS` и `FILL_COLOR_OPTIONS` из
`scenarioTableModel.ts`. Не использовать `dangerouslySetInnerHTML`. Значение:

```tsx
<p data-side={side} style={valueStyle(value)}>
  {value?.text || "—"}
</p>
```

Для moved row:

```tsx
{change.moved ? (
  <span className="history-diff-moved">
    Строка: {change.before_order ?? "—"} → {change.after_order ?? "—"}
  </span>
) : null}
```

Для каждого `SemanticFieldDiff` показать label и «Было / Стало». Для
added/removed оставить только непустую сторону с label «Добавлено»/«Удалено».

- [ ] **Step 4: Обновить CSS без широкого JSON layout**

В `history.css`:

```css
.history-diff-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.history-diff-state-range {
  color: var(--color-ink-muted);
  font-size: 12px;
  font-weight: 600;
}

.history-diff-text p {
  min-height: 38px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

Удалить неиспользуемый `.history-revisions`. На `max-width: 700px`
`.history-diff-head` складывать в колонку. Не добавлять горизонтальный scroll
или `<pre>`.

- [ ] **Step 5: Обновить E2E fixtures и записать RED/GREEN browser assertions**

В `story-history.spec.ts` raw diff fixture должен содержать:

```ts
before: {
  order_index: 1,
  block_type: "zk_geo",
  text: "Старый текст",
  file_name: "before.mov",
  tc_in: "00:01",
  tc_out: "00:05",
  structured_data: { geo: "Староград" },
  formatting: { targets: { text: { bold: false } } },
  rich_text: {
    schema_version: 1,
    targets: { text: { text: "Старый текст", html: "Старый текст" } },
  },
},
```

После открытия diff проверить:

```ts
await expect(page.getByText("Староград")).toBeVisible();
await expect(page.getByText("Сохранённые состояния 0 → 3")).toBeVisible();
await expect(page.getByText(/structured_data|schema_version|targets/i)).toHaveCount(0);
await expect(page.getByText(/Редакции 0 → 3/i)).toHaveCount(0);
```

Restore action:

```ts
await page.getByRole("button", { name: "Восстановить" }).click();
await page.getByRole("button", { name: "Восстановить состояние" }).click();
```

В `notification-routing.spec.ts`:

```ts
await expect(tray.getByText("Изменений: 2")).toBeVisible();
await expect(tray.getByText(/Редакции 4 → 7/i)).toHaveCount(0);
```

В `production-workflow.spec.ts`:

```ts
const workflow = page.getByRole("region", {
  name: "Редакционная проверка и корректура",
});
await expect(workflow).toContainText("Астра");
await expect(workflow).not.toContainText(/редакци(?:я|и)\s+\d/i);
```

Network assertions `{ revision: 7 }` не удалять: они доказывают, что скрыт
только presentation, а server binding сохранён.

- [ ] **Step 6: Запустить component и targeted browser GREEN**

Из-за `reuseExistingServer: false` сначала остановить только local frontend,
затем обязательно вернуть его:

```bash
cd /Volumes/work/Projects/NewscastNavigator-product-reset
docker compose --env-file .env.example -f compose.yaml stop frontend
cd frontend
npm test -- --run \
  src/features/history/semanticScenarioDiff.test.ts \
  src/features/history/HistoryTimeline.test.tsx \
  src/features/workflow/WorkflowActions.test.tsx \
  src/features/notifications/AttentionQueue.test.tsx
npx playwright test \
  e2e/story-history.spec.ts \
  e2e/notification-routing.spec.ts \
  e2e/production-workflow.spec.ts \
  --workers=2
cd ..
docker compose --env-file .env.example -f compose.yaml start frontend
```

Expected: component tests PASS; targeted E2E проходит на Chromium 1366/1920;
frontend container возвращается в `healthy`.

- [ ] **Step 7: CodeRabbit review и локальный commit**

Run:

```bash
git add \
  frontend/src/features/history/components/ScenarioSessionDiff.tsx \
  frontend/src/features/history/HistoryTimeline.test.tsx \
  frontend/src/styles/history.css \
  frontend/e2e/production-workflow.spec.ts \
  frontend/e2e/notification-routing.spec.ts \
  frontend/e2e/story-history.spec.ts
coderabbit review --agent -t uncommitted -c AGENTS.md
git diff --cached --check
git commit -m "fix(history): render readable scenario changes"
```

Expected: UI integration independently reviewed and committed.

---

### Task 4: Полная проверка, actual UI и документация

**Files:**
- Modify: `docs/product-reset/SPEC_RU.md:165-180,353-370`
- Modify: `docs/product-reset/PROGRESS.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: проверенный local completion boundary без нового external evidence.

- [ ] **Step 1: Обновить source-of-truth документацию**

В `SPEC_RU.md` явно добавить:

```markdown
Технический номер серверной редакции не показывается как пользовательская
версия. Он допустим только вторичным контекстом открытого сравнения.

История показывает семантические изменения видимых полей сценария. Сырые
structured_data, formatting, rich_text и неизвестные внутренние поля в
пользовательский интерфейс не выводятся.
```

В `PROGRESS.md` записать:

- RED-команды и точные причины падения;
- локальные commits Tasks 1–3;
- CodeRabbit findings и решения;
- targeted/full tests;
- manual browser coordinates/screens checked;
- standard build result и только фактические environment blockers;
- отсутствие push/PR/merge/deploy;
- expected external-evidence boundary.

- [ ] **Step 2: Запустить полный backend и frontend unit-набор**

Run:

```bash
cd backend
./.venv/bin/pytest -q
cd ../frontend
npm test -- --run
```

Expected: все tests PASS; skips только ранее документированные.

- [ ] **Step 3: Запустить production build и Compose validation**

Run:

```bash
cd frontend
npm run build
cd ..
docker compose --env-file .env.example -f compose.yaml config --quiet
```

Expected: оба exit `0`. Если стандартная очистка `frontend/dist` снова
заблокирована ignored `.smbdelete*`, зафиксировать exact error, не завершать
Virtualization process и дополнительно доказать TypeScript/Vite:

```bash
cd frontend
npm run build -- --emptyOutDir false
```

- [ ] **Step 4: Запустить полную browser matrix**

Run:

```bash
cd /Volumes/work/Projects/NewscastNavigator-product-reset
docker compose --env-file .env.example -f compose.yaml stop frontend
cd frontend
npx playwright test --workers=2
cd ..
docker compose --env-file .env.example -f compose.yaml start frontend
```

Expected: полная Chromium 1366/1920 matrix PASS; допустимы только штатные
BFCache skips. После запуска
`docker compose --env-file .env.example -f compose.yaml ps` показывает три
`healthy`.

- [ ] **Step 5: Проверить фактический интерфейс**

На `http://127.0.0.1:5173/stories/1/scenario` проверить:

- workflow содержит actor/time и рабочие статусы, но не `редакция N`;
- autosave и редактирование продолжают работать без layout/focus shift.

На `/stories/1/history` проверить:

- карточки сеансов не показывают диапазоны;
- открытый diff показывает secondary `Сохранённые состояния X → Y`;
- гео, СНХ, текст, formatting-only, file bundles/TC и «В кадре» читаемы;
- JSON keys и JSON blocks отсутствуют;
- restore dialog использует «Восстановить состояние».

В notification tray проверить `Изменений: N` без диапазона. Осмотреть минимум
`1366x768` и `1920x1080`, horizontal overflow отсутствует.

- [ ] **Step 6: Запустить fail-closed eval verify**

Run:

```bash
backend/.venv/bin/python backend/scripts/product_reset_eval.py \
  verify --scope final --repo-root .
```

Expected: до нового разрешённого clean deploy/demo exit `2` только по
`full_eval_passed`; старая exact-SHA external evidence не переносится.

- [ ] **Step 7: Final diff review и docs commit**

Run:

```bash
git diff --check
git status --short
git add \
  docs/product-reset/SPEC_RU.md \
  docs/product-reset/PROGRESS.md
git commit -m "docs(product-reset): record semantic history correction"
git status --short
git log --oneline -6
```

Expected: worktree clean; последние commits соответствуют Tasks 1–4; никаких
remote mutations нет.

---

## Completion Boundary

План завершён локально, когда:

- технические revision anchors сохранены в API/commands и нигде не стали
  пользовательскими версиями;
- номера отсутствуют в workflow, production, notifications, history cards и
  restore dialog;
- открытый diff показывает только secondary saved-state range;
- raw JSON и неизвестные поля отсутствуют;
- все видимые поля таблицы и formatting-only изменения представлены
  семантически;
- restore остаётся append-only;
- targeted/full unit, build, Compose и полная browser matrix проверены;
- CodeRabbit findings обработаны;
- `SPEC_RU.md` и `PROGRESS.md` соответствуют поведению;
- созданы только локальные commits, без push/PR/merge/deploy.
