# NewscastNavigator v1.1.2 и v1.2.0 — план реализации полевых исправлений

> **Для агентных исполнителей:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК: выполнять этот план task-by-task через `superpowers:subagent-driven-development` (предпочтительно) или `superpowers:executing-plans`. Шаги отслеживаются checkbox-синтаксисом `- [ ]`.

**Цель:** последовательно выпустить локально проверяемые кандидаты `v1.1.2` и `v1.2.0`, устраняющие подтверждённые полевой эксплуатацией дефекты и добавляющие утверждённые редакторские инструменты без production deploy.

**Архитектура:** `v1.1.2` остаётся узким hotfix без изменения backend-контрактов: ввод `+`, ограниченный контейнер шапки и общий hook видимого polling. `v1.2.0` добавляет один локальный scenario-wide history-контроллер над массивом строк, атомарные редакторские операции, реестр текстовых полей и небольшие изолированные модули кавычек, перестановки и поиска. Сервер по-прежнему хранит один актуальный сценарий, а штатное автосохранение получает итоговые массивы строк.

**Стек:** React 18, TypeScript 5.6, Tiptap 3, Vitest/Testing Library, Playwright Chromium, FastAPI/Python 3.11, python-docx, Docker Compose.

**Спецификации:**

- `docs/product-reset/V1_1_2_FIELD_HOTFIX_DESIGN_RU.md`
- `docs/product-reset/V1_2_0_EDITOR_TOOLS_DESIGN_RU.md`
- `docs/product-reset/SPEC_RU.md`
- `docs/product-reset/EVAL_RUBRIC_RU.md`

## Глобальные ограничения

- Обратный импорт DOCX, сравнение и применение внешних изменений не реализуются.
- В продукте остаётся один актуальный сценарий; не добавлять ручные версии, branch/merge или параллельный режим редактора.
- Локальное состояние редактора остаётся главным во время ввода; ответ сервера не заменяет весь открытый редактор.
- Устаревший ответ не может перезаписать более свежий ввод, undo/redo или замену.
- Успешное сохранение не меняет layout, focus, selection или scroll; ошибка не уничтожает локальный текст.
- Polling уведомлений — 5 секунд только при видимой вкладке, плюс немедленный refresh при focus/visibility и собственном событии инвалидирования.
- История редактора — не более 100 шагов; ввод одного поля объединяется в пределах 750 мс.
- Поиск и умные кавычки работают только по `text`, `geo`, `speaker_fio`, `speaker_position` и `additional_comment` («В кадре»).
- Имена файлов, таймкоды, заголовок, рубрика и служебные метаданные исключены из поиска и умных кавычек.
- Franklin Gothic Book используется как системный шрифт; файлы `.ttf` не добавляются в Git или web bundle.
- Окно «Что нового» показывается один раз на сочетание `user.id + APP_VERSION + browser storage`; отказ storage не блокирует приложение.
- Новая production-зависимость для drag-and-drop не добавляется без отдельного пересогласования.
- Физическая проверка Windows и Alt Linux откладывается до доступа к целевым машинам и не объявляется пройденной.
- Не выполнять push, PR, merge, tag или deploy без отдельной команды владельца.

---

## Release checkpoint A — v1.1.2

### Task 1: Нормализовать аппаратный ввод `+` в файловых полях

**Файлы:**

- Create: `frontend/src/features/scenario/fileBundleInput.test.ts`
- Create: `frontend/src/features/scenario/fileBundleInput.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioRow.tsx`
- Modify: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`

**Интерфейсы:**

- Produces: `isFileBundlePlusKey(event: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "isComposing">): boolean`.
- Produces: `replaceInputSelection(value: string, start: number | null, end: number | null, inserted: string): { value: string; caret: number }`.
- Consumes: существующие `resolveFileBundleInput`, `updateFileBundle`, `updateRowFileBundles`.

- [ ] **Шаг 1: написать падающие unit-тесты аппаратных вариантов**

```ts
expect(isFileBundlePlusKey({ code: "Equal", key: "+", shiftKey: true, isComposing: false })).toBe(true);
expect(isFileBundlePlusKey({ code: "NumpadAdd", key: "+", shiftKey: false, isComposing: false })).toBe(true);
expect(isFileBundlePlusKey({ code: "Equal", key: "=", shiftKey: false, isComposing: false })).toBe(false);
expect(isFileBundlePlusKey({ code: "Equal", key: "+", shiftKey: true, isComposing: true })).toBe(false);
expect(replaceInputSelection("AB", 1, 1, "+")).toEqual({ value: "A+B", caret: 2 });
expect(replaceInputSelection("A=B", 1, 2, "+")).toEqual({ value: "A+B", caret: 2 });
```

- [ ] **Шаг 2: запустить тест и подтвердить RED**

Run: `cd frontend && npm test -- --run src/features/scenario/fileBundleInput.test.ts`

Expected: FAIL, потому что `fileBundleInput.ts` и экспортируемые функции отсутствуют.

- [ ] **Шаг 3: реализовать минимальные чистые функции**

```ts
export function isFileBundlePlusKey(
  event: Pick<KeyboardEvent, "code" | "key" | "shiftKey" | "isComposing">,
) {
  return !event.isComposing
    && ((event.code === "Equal" && event.shiftKey) || event.code === "NumpadAdd");
}

export function replaceInputSelection(
  value: string,
  start: number | null,
  end: number | null,
  inserted: string,
) {
  const from = start ?? value.length;
  const to = end ?? from;
  return {
    value: `${value.slice(0, from)}${inserted}${value.slice(to)}`,
    caret: from + inserted.length,
  };
}
```

- [ ] **Шаг 4: закрепить браузерное событие в компонентном тесте**

В characterization-тесте вызвать `fireEvent.keyDown` для поля «Добавить файл блока 2» с `{ key: "+", code: "Equal", shiftKey: true }`, затем проверить, что создан один файловый блок с отображаемым `+`, а `+=` отсутствует. Отдельно проверить, что `{ key: "=", code: "Equal", shiftKey: false }` оставляет обычный `=` и что `fireEvent.change` с paste-подобным `"A+=B"` не переписывается.

- [ ] **Шаг 5: подключить защиту к существующим и draft-полям**

В `ScenarioRow.tsx` вынести существующую логику изменения draft в локальный `applyFileBundleDraft(rawValue)` и на `onKeyDown`:

```ts
if (isFileBundlePlusKey(event.nativeEvent)) {
  event.preventDefault();
  const next = replaceInputSelection(
    event.currentTarget.value,
    event.currentTarget.selectionStart,
    event.currentTarget.selectionEnd,
    "+",
  );
  applyFileBundleDraft(next.value);
}
```

Для уже созданного bundle использовать тот же helper вставки, затем существующие `resolveFileBundleInput` и `updateFileBundle`. После React-render восстановить вычисленную позицию курсора через ref/requestAnimationFrame. Не добавлять обработчик к таймкодам.

- [ ] **Шаг 6: запустить scoped-тесты и build**

Run: `cd frontend && npm test -- --run src/features/scenario/fileBundleInput.test.ts src/pages/__tests__/EditorPage.characterization.test.tsx`

Run: `cd frontend && npm run build`

Expected: PASS; TypeScript не допускает невалидные event-типы.

- [ ] **Шаг 7: создать локальный коммит**

```bash
git add frontend/src/features/scenario/fileBundleInput.ts frontend/src/features/scenario/fileBundleInput.test.ts frontend/src/features/scenario/components/ScenarioRow.tsx frontend/src/pages/__tests__/EditorPage.characterization.test.tsx
git commit -m "fix(editor): normalize plus key input"
```

### Task 2: Ограничить шапку и сделать identity ссылкой на главную

**Файлы:**

- Modify: `frontend/src/components/app-shell/AppShell.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.test.tsx`
- Modify: `frontend/src/styles/layout.css`
- Create: `frontend/e2e/layout-wide.spec.ts`
- Modify: `frontend/playwright.config.ts`

**Интерфейсы:**

- Produces: `.app-shell-header-inner` — единственный grid-контейнер элементов шапки с `width: min(100%, 1440px)`.
- Produces: ссылка `.app-shell-identity[href="/stories"]` с доступным именем «На главную».

- [ ] **Шаг 1: написать падающие component-тесты структуры и навигации**

```tsx
const home = screen.getByRole("link", { name: "На главную" });
expect(home).toHaveAttribute("href", "/stories");
expect(home).toContainElement(screen.getByRole("heading", { level: 1, name: "Newscast Navigator" }));
expect(container.querySelector(".app-shell-header > .app-shell-header-inner")).toBeInTheDocument();
```

- [ ] **Шаг 2: запустить тест и подтвердить RED**

Run: `cd frontend && npm test -- --run src/components/app-shell/AppShell.test.tsx`

Expected: FAIL: identity пока `div`, внутреннего контейнера нет.

- [ ] **Шаг 3: изменить разметку без изменения SPA-контракта**

Внутри `<header className="app-shell-header">` создать `<div className="app-shell-header-inner">`, а identity заменить на:

```tsx
<a className="app-shell-identity" href="/stories" aria-label="На главную">
  <p>Редакционный эфир</p>
  <h1>Newscast Navigator</h1>
</a>
```

Глобальный перехват внутренних ссылок `AppRouter` сохраняется; отдельный router API в `AppShell` не добавлять.

- [ ] **Шаг 4: перенести grid и responsive-правила на внутренний контейнер**

`.app-shell-header` оставляет sticky, фон, border и shadow на всю ширину. `.app-shell-header-inner` получает текущий grid, `width: min(100%, 1440px)`, `margin: 0 auto` и текущие горизонтальные padding. Для `.app-shell-identity` добавить `display: grid; color: inherit; text-decoration: none`. Media queries 1050/760 применить к inner.

- [ ] **Шаг 5: добавить узкий 2560px browser-контракт**

`layout-wide.spec.ts` после synthetic login/route проверяет:

```ts
const header = page.locator(".app-shell-header-inner");
const content = page.locator(".app-shell-content");
expect((await header.boundingBox())!.width).toBeLessThanOrEqual(1440);
expect(Math.abs((await header.boundingBox())!.x - (await content.boundingBox())!.x)).toBeLessThanOrEqual(1);
```

В `playwright.config.ts` добавить проект `chromium-2560-layout` с viewport `2560×1440` и `testMatch: ["**/layout-wide.spec.ts"]`; двум основным проектам добавить `testIgnore: ["**/layout-wide.spec.ts"]`, чтобы не дублировать специальный тест.

- [ ] **Шаг 6: проверить component/build и специальный browser-тест**

Run: `cd frontend && npm test -- --run src/components/app-shell/AppShell.test.tsx src/test/playwrightConfig.test.ts`

Run: `cd frontend && npm run build`

Run: `cd frontend && npm run test:e2e -- --project=chromium-2560-layout`

Expected: PASS на 2560px; существующие проекты остаются 1366/1920.

- [ ] **Шаг 7: создать локальный коммит**

```bash
git add frontend/src/components/app-shell/AppShell.tsx frontend/src/components/app-shell/AppShell.test.tsx frontend/src/styles/layout.css frontend/e2e/layout-wide.spec.ts frontend/playwright.config.ts frontend/src/test/playwrightConfig.test.ts
git commit -m "fix(shell): align wide header and link home"
```

### Task 3: Добавить видимое polling-обновление уведомлений и внешнее закрытие

**Файлы:**

- Create: `frontend/src/features/notifications/useWorkspaceRefreshClock.ts`
- Create: `frontend/src/features/notifications/useWorkspaceRefreshClock.test.tsx`
- Create: `frontend/src/features/notifications/useSerializedRefresh.ts`
- Create: `frontend/src/features/notifications/useSerializedRefresh.test.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.tsx`
- Modify: `frontend/src/features/notifications/components/NotificationTray.tsx`
- Modify: `frontend/src/features/notifications/components/AttentionQueue.tsx`
- Modify: `frontend/src/features/notifications/AttentionQueue.test.tsx`

**Интерфейсы:**

- Produces: `WORKSPACE_REFRESH_INTERVAL_MS = 5_000`.
- Produces: `useWorkspaceRefreshClock(intervalMs?: number): void`, один раз подключённый в `AppShell` и публикующий `NOTIFICATIONS_INVALIDATED_EVENT`.
- Produces: `useSerializedRefresh(load: (generation: number) => Promise<void>): { refreshNow: () => void; supersede: () => void }`.
- Consumes: `NOTIFICATIONS_INVALIDATED_EVENT`, `fetchNotifications`, `fetchPersonalActions`.

- [ ] **Шаг 1: написать RED-тесты clock и serialized controller с fake timers**

Для clock проверить тик через 5000 мс, отсутствие события в hidden-вкладке, немедленное событие на focus/visible, объединение focus+visibility в один микротакт и cleanup. Для controller проверить запрет второго одновременного promise, один queued refresh после завершения, generation после `supersede()` и отсутствие update после unmount.

```ts
vi.useFakeTimers();
const pending = deferred<void>();
const refresh = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
const { result } = renderHook(() => useSerializedRefresh(refresh));
act(() => result.current.refreshNow());
act(() => result.current.refreshNow());
expect(refresh).toHaveBeenCalledTimes(1);
pending.resolve();
await act(async () => Promise.resolve());
expect(refresh).toHaveBeenCalledTimes(2);
```

- [ ] **Шаг 2: запустить тесты и подтвердить RED**

Run: `cd frontend && npm test -- --run src/features/notifications/useWorkspaceRefreshClock.test.tsx src/features/notifications/useSerializedRefresh.test.tsx`

Expected: FAIL: оба hook отсутствуют.

- [ ] **Шаг 3: реализовать один clock и сериализованный lifecycle**

Clock публикует существующее событие из `AppShell`; interval работает только при `document.visibilityState === "visible"`, focus/visibility проходят microtask-coalescing. Serialized hook хранит callback, `inFlightRef`, `queuedRef`, `generationRef` и `mountedRef`. Повторный сигнал во время GET ставит один queued refresh; `supersede()` повышает generation, поэтому consumer игнорирует результат более старого GET. Cleanup снимает interval/listeners и запрещает state update после unmount.

- [ ] **Шаг 4: написать RED-тесты компонентов и гонок**

В `AttentionQueue.test.tsx` добавить проверки:

- tray и queue получают новый ответ после clock-события без reload;
- reject poll сохраняет последний хороший badge/list;
- GET, начатый до `readNotification`, не возвращает локально удалённое уведомление;
- preview-poll не перезаписывает полный раскрытый список queue;
- tray закрывается toggle, pointerdown вне wrap и `Escape`;
- клик внутри tray не закрывает;
- после `Escape` focus возвращается на toggle.

- [ ] **Шаг 5: подключить clock/controller и безопасное состояние**

`NotificationTray` слушает `NOTIFICATIONS_INVALIDATED_EVENT`, запускает controller и обновляет state только при актуальном generation success; catch больше не очищает данные. Перед локальным применением успешного `readNotification` вызывается `supersede()`. `AttentionQueue` использует такой же controller; initial failure остаётся нулевым состоянием, но failure после success сохраняет preview. Full-load supersede-ит старый preview, а последующий polling использует `limitRef`, достаточный для раскрытого total.

Для tray добавить refs wrap/toggle и document `pointerdown` только пока панель открыта. `Escape` закрывает панель, затем через `requestAnimationFrame` возвращает focus на toggle.

- [ ] **Шаг 6: прогнать scoped и интеграционные тесты**

Run: `cd frontend && npm test -- --run src/features/notifications/useWorkspaceRefreshClock.test.tsx src/features/notifications/useSerializedRefresh.test.tsx src/features/notifications/AttentionQueue.test.tsx src/components/app-shell/AppShell.test.tsx`

Run: `cd frontend && npm run build`

Expected: PASS; fake timers восстановлены в `afterEach`, открытых timer handles нет.

- [ ] **Шаг 7: создать локальный коммит**

```bash
git add frontend/src/features/notifications/useWorkspaceRefreshClock.ts frontend/src/features/notifications/useWorkspaceRefreshClock.test.tsx frontend/src/features/notifications/useSerializedRefresh.ts frontend/src/features/notifications/useSerializedRefresh.test.tsx frontend/src/components/app-shell/AppShell.tsx frontend/src/features/notifications/components/NotificationTray.tsx frontend/src/features/notifications/components/AttentionQueue.tsx frontend/src/features/notifications/AttentionQueue.test.tsx
git commit -m "fix(notifications): refresh visible workspace state"
```

### Task 4: Оформить и полностью проверить локальный checkpoint v1.1.2

**Файлы:**

- Modify: `backend/pyproject.toml`
- Modify: `backend/app/core/version.py`
- Modify: `backend/tests/test_app_version.py`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/components/AppFooter.test.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.test.tsx`
- Modify: `CHANGELOG.md`
- Modify: `docs/product-reset/PROGRESS.md`

**Интерфейсы:**

- Produces: единая application version `1.1.2` во всех runtime manifest-файлах.

- [ ] **Шаг 1: обновить version test на ожидаемый `1.1.2` и подтвердить RED**

Run: `cd backend && pytest -q tests/test_app_version.py`

Expected: FAIL, пока manifest-файлы содержат `1.1.1`.

- [ ] **Шаг 2: механически обновить runtime version**

Изменить только `backend/pyproject.toml`, `FALLBACK_APP_VERSION`, корневые version-поля `frontend/package.json` и `frontend/package-lock.json`. Исторические упоминания `1.1.1` в старых разделах документации и синтетических evidence не переписывать.

- [ ] **Шаг 3: обновить footer-тесты и PROGRESS**

Добавить в начало `PROGRESS.md` новый раздел `Версия 1.1.2 — срочные полевые исправления` с выполненными тестовыми контрактами, Mac-only ограничением и явным `NOT DEPLOYED`. Добавить changelog-секцию `[1.1.2] - 2026-08-23`. Footer-тесты ожидают `Newscast Navigator v1.1.2`.

- [ ] **Шаг 4: запустить полный checkpoint gate**

Run: `cd backend && pytest -q`

Run: `cd frontend && npm test -- --run`

Run: `cd frontend && npm run build`

Run: `docker compose -f compose.yaml config`

Run: `cd frontend && npm run test:e2e -- --project=chromium-1366 --project=chromium-1920 --project=chromium-2560-layout`

Expected: все доступные тесты PASS; нет изменения схемы БД.

- [ ] **Шаг 5: вручную проверить локальный Compose-стенд**

Если `.env` отсутствует, создать его безопасным копированием `.env.example`; существующий `.env` не перезаписывать. Запустить `docker compose --env-file .env -f compose.yaml up --build --wait`, проверить health backend на `127.0.0.1:8100`, UI на `127.0.0.1:5173`, `+`, шапку, home link, polling и внешнее закрытие. После проверки остановить только созданный локальный Compose stack, не трогая сервер.

- [ ] **Шаг 6: создать локальный release checkpoint-коммит**

```bash
git add backend/pyproject.toml backend/app/core/version.py backend/tests/test_app_version.py frontend/package.json frontend/package-lock.json frontend/src/components/AppFooter.test.tsx frontend/src/components/app-shell/AppShell.test.tsx CHANGELOG.md docs/product-reset/PROGRESS.md
git commit -m "chore(release): prepare v1.1.2 field hotfix"
```

---

## Release checkpoint B — v1.2.0

### Task 5: Создать чистую модель общей истории сценария

**Файлы:**

- Create: `frontend/src/features/scenario/scenarioHistory.ts`
- Create: `frontend/src/features/scenario/scenarioHistory.test.ts`

**Интерфейсы:**

```ts
export type ScenarioMutationMeta =
  | {
      kind: "typing" | "field";
      groupKey: string;
      timestamp?: number;
    }
  | {
      kind: "formatting" | "structure" | "replace" | "replace-all";
      timestamp?: number;
    };

export interface ScenarioHistoryTransition {
  state: ScenarioHistoryState;
  rows: ScenarioRow[];
}

export interface ScenarioHistorySnapshot {
  rows: ScenarioRow[];
}

export interface ScenarioHistoryState {
  past: ScenarioHistorySnapshot[];
  future: ScenarioHistorySnapshot[];
  lastGroupKey: string | null;
  lastRecordedAt: number;
}

export const SCENARIO_HISTORY_LIMIT = 100;
export const SCENARIO_TYPING_GROUP_MS = 750;
export function recordScenarioMutation(
  state: ScenarioHistoryState,
  beforeRows: ScenarioRow[],
  nextRows: ScenarioRow[],
  meta: ScenarioMutationMeta,
): ScenarioHistoryState;
export function undoScenarioMutation(
  state: ScenarioHistoryState,
  currentRows: ScenarioRow[],
): ScenarioHistoryTransition | null;
export function redoScenarioMutation(
  state: ScenarioHistoryState,
  currentRows: ScenarioRow[],
): ScenarioHistoryTransition | null;
export function resetScenarioHistory(): ScenarioHistoryState;
```

- [ ] **Шаг 1: написать RED-тесты модели**

Проверить deep snapshot (последующая мутация rows не меняет past), undo/redo, очистку future после новой правки, объединение одинакового `groupKey` в 750 мс, новую запись после 751 мс, отдельные `formatting/structure/replace/replace-all` операции и обрезку до 100 шагов.

- [ ] **Шаг 2: запустить тест и подтвердить RED**

Run: `cd frontend && npm test -- --run src/features/scenario/scenarioHistory.test.ts`

Expected: FAIL: module отсутствует.

- [ ] **Шаг 3: реализовать immutable history**

Использовать `structuredClone` только на границе записи/возврата snapshots. Не хранить metadata сюжета или серверную revision. Для no-op сравнивать сериализованное содержимое строк или принимать от вызывающего кода только реально изменённые массивы.

- [ ] **Шаг 4: прогнать тесты и закоммитить**

Run: `cd frontend && npm test -- --run src/features/scenario/scenarioHistory.test.ts`

```bash
git add frontend/src/features/scenario/scenarioHistory.ts frontend/src/features/scenario/scenarioHistory.test.ts
git commit -m "feat(editor): add scenario history model"
```

### Task 6: Интегрировать scenario-wide undo/redo

**Файлы:**

- Create: `frontend/src/features/scenario/components/ScenarioHistoryControls.tsx`
- Create: `frontend/src/features/scenario/components/ScenarioHistoryControls.test.tsx`
- Modify: `frontend/src/features/editor-core/extensions.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioEditor.tsx`
- Modify: `frontend/src/features/scenario/components/ScenarioRow.tsx`
- Modify: `frontend/src/features/scenario/ScenarioEditor.autosave.test.tsx`
- Modify: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`
- Modify: `frontend/src/styles/scenario.css`

**Интерфейсы:**

- Consumes: все функции `scenarioHistory.ts`.
- Produces: `mutate(updater, meta: ScenarioMutationMeta)` — единственная граница локальной правки строк.
- Produces: `EditorFocusBookmark` для Tiptap и native input selection.
- Produces: кнопки `Отменить` и `Повторить` с `canUndo/canRedo`.

```ts
export type EditorFocusBookmark =
  | { kind: "tiptap"; editorId: string; from: number; to: number }
  | {
      kind: "native";
      ariaLabel: string;
      selectionStart: number | null;
      selectionEnd: number | null;
    };
```

- [ ] **Шаг 1: написать RED-тесты controls и autosave integration**

Проверить disabled-состояния, aria-label/title и клики. В autosave-тесте ввести две буквы в одно поле в пределах 750 мс, нажать `Cmd+Z`/`Ctrl+Z`, убедиться, что вернулось состояние до группы и был запланирован один актуальный save; затем redo возвращает текст. Отдельно проверить undo добавления, удаления, форматирования, файла и перестановки.

- [ ] **Шаг 2: отключить внутреннюю Tiptap undo-историю**

В `StarterKit.configure` установить поддерживаемую Tiptap 3 опцию `undoRedo: false` (после проверки локальных typings установленной версии). Scoped-тест должен подтвердить, что `Cmd+Z` перехватывает только ScenarioEditor.

- [ ] **Шаг 3: заменить `mutate` на history-aware границу**

Перед updater брать `before = rowsRef.current`, после `ensureEditableRows` — `next`. Если они различаются, записывать history с meta, синхронно обновлять `rowsRef`, React state, lease и autosave. Для полей использовать group keys:

```ts
`field:${row.segment_uid}:text`
`field:${row.segment_uid}:geo`
`field:${row.segment_uid}:speaker_fio`
`field:${row.segment_uid}:speaker_position`
`field:${row.segment_uid}:additional_comment`
`field:${row.segment_uid}:file:${bundleIndex}:${property}`
```

Структурные и formatting-операции передают `{ kind: "structure" }` и `{ kind: "formatting" }`; `groupKey` разрешён только для `typing/field`.

- [ ] **Шаг 4: реализовать undo/redo без повторной записи history**

`applyHistoryRows(rows)` обновляет refs/state, вызывает lease и `autosave.scheduleSave`, но не `recordScenarioMutation`. Перед применением сохранить `window.scrollY`, активное поле и selection; после render восстановить focus с `preventScroll`, selection и scroll. При смене `storyId` и явном выборе «Использовать текст с сервера» history сбрасывается. Matching persisted draft становится новым baseline. При выборе «Продолжить с локальным текстом» существующая локальная history сохраняется; временная ошибка save history не очищает.

- [ ] **Шаг 5: подключить UI и клавиши**

Controls располагаются в существующей sticky toolbar. Глобальный keydown для undo/redo выполняется до `isEditableKeyboardTarget`, поэтому работает внутри Tiptap/input/textarea. Поддержать `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`, `Ctrl+Y`; не перехватывать их в read-only.

- [ ] **Шаг 6: прогнать scoped test/build и закоммитить**

Run: `cd frontend && npm test -- --run src/features/scenario/scenarioHistory.test.ts src/features/scenario/components/ScenarioHistoryControls.test.tsx src/features/scenario/ScenarioEditor.autosave.test.tsx src/pages/__tests__/EditorPage.characterization.test.tsx`

Run: `cd frontend && npm run build`

```bash
git add frontend/src/features/editor-core/extensions.ts frontend/src/features/scenario/scenarioHistory.ts frontend/src/features/scenario/components/ScenarioHistoryControls.tsx frontend/src/features/scenario/components/ScenarioHistoryControls.test.tsx frontend/src/features/scenario/components/ScenarioEditor.tsx frontend/src/features/scenario/components/ScenarioRow.tsx frontend/src/features/scenario/ScenarioEditor.autosave.test.tsx frontend/src/pages/__tests__/EditorPage.characterization.test.tsx frontend/src/styles/scenario.css
git commit -m "feat(editor): add scenario-wide undo redo"
```

### Task 7: Добавить перетаскивание блоков без новой зависимости

**Файлы:**

- Create: `frontend/src/features/scenario/scenarioRowReorder.ts`
- Create: `frontend/src/features/scenario/scenarioRowReorder.test.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioRow.tsx`
- Modify: `frontend/src/features/scenario/components/ScenarioEditor.tsx`
- Modify: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`
- Modify: `frontend/e2e/editor-characterization.spec.ts`
- Modify: `frontend/src/styles/scenario.css`

**Интерфейсы:**

- Produces: `reorderScenarioRows(rows: ScenarioRow[], sourceUid: string, targetUid: string, edge: "before" | "after"): ScenarioRow[]`.
- Produces: `ScenarioRow` props `dragging`, `dropEdge`, `onDragPointerDown`; `ScenarioEditor` владеет pointer lifecycle и cleanup.

- [ ] **Шаг 1: написать RED unit-тесты перестановки**

Проверить before/after вверх и вниз, перенос к началу/концу, неизвестный uid и drop на исходное место. Результат всегда проходит `withOrderIndexes`, input-массив не мутируется.

- [ ] **Шаг 2: реализовать чистую перестановку и подтвердить GREEN**

Run: `cd frontend && npm test -- --run src/features/scenario/scenarioRowReorder.test.ts`

- [ ] **Шаг 3: добавить нативную drag handle и визуальную точку вставки**

В блоке row actions добавить кнопку-рукоятку `aria-label="Перетащить блок N"`. Только её `pointerdown` запускает drag: `ScenarioEditor` регистрирует `pointermove/pointerup/pointercancel`, через `document.elementFromPoint(moveEvent.clientX, moveEvent.clientY).closest('tr[data-segment-uid]')` находит target и вычисляет edge по вертикальной середине строки. `pointerup` над допустимой строкой вызывает `mutate(current => reorderScenarioRows(current, sourceUid, targetUid, edge), { kind: "structure" })`; cancel/drop вне таблицы ничего не меняет. Cleanup снимает listeners, `user-select` и drag-state при завершении и unmount.

Существующие ↑/↓ и `Alt+Shift+Arrow` не удалять. CSS показывает cursor grab/grabbing, полупрозрачный source и линию before/after без изменения ширины таблицы.

- [ ] **Шаг 4: добавить component/browser-проверку**

Characterization-тест проверяет рукоятку и один reorder callback. Playwright двигает мышь от bounding box рукоятки к нижней половине третьей строки, проверяет новый порядок и один сохранённый payload; затем проверяет, что кнопка вверх возвращает строку без мыши.

- [ ] **Шаг 5: прогнать тесты и закоммитить**

Run: `cd frontend && npm test -- --run src/features/scenario/scenarioRowReorder.test.ts src/pages/__tests__/EditorPage.characterization.test.tsx`

Run: `cd frontend && npm run test:e2e -- --project=chromium-1366 e2e/editor-characterization.spec.ts`

```bash
git add frontend/src/features/scenario/scenarioRowReorder.ts frontend/src/features/scenario/scenarioRowReorder.test.ts frontend/src/features/scenario/components/ScenarioRow.tsx frontend/src/features/scenario/components/ScenarioEditor.tsx frontend/src/pages/__tests__/EditorPage.characterization.test.tsx frontend/e2e/editor-characterization.spec.ts frontend/src/styles/scenario.css
git commit -m "feat(editor): drag scenario blocks"
```

### Task 8: Добавить умные русские кавычки в prose-поля

**Файлы:**

- Create: `frontend/src/features/editor-core/russianQuotes.ts`
- Create: `frontend/src/features/editor-core/russianQuotes.test.ts`
- Create: `frontend/src/features/editor-core/RussianQuotesExtension.ts`
- Create: `frontend/src/features/editor-core/RussianQuotesExtension.test.ts`
- Modify: `frontend/src/features/editor-core/extensions.ts`
- Modify: `frontend/src/features/scenario/scenarioTableModel.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioRow.tsx`
- Modify: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`

**Интерфейсы:**

```ts
export interface RussianQuoteEdit {
  insert: string;
  caretOffset: number;
}
export function resolveRussianQuoteEdit(before: string, selected: string, after: string): RussianQuoteEdit;
export const RussianQuotesExtension: Extension;
export type ScenarioTextTargetKey = FormatTargetKey | "additional_comment";
```

- [ ] **Шаг 1: написать RED unit-тесты всех правил**

Проверить начало строки, пробел/`(`/`—` слева, закрывающий контекст, выделение, уже существующую `»` справа, multiline и отсутствие преобразования любого символа кроме непосредственного `"`.

```ts
expect(resolveRussianQuoteEdit("", "", "")).toEqual({ insert: "«»", caretOffset: 1 });
expect(resolveRussianQuoteEdit("Сказал ", "текст", " далее")).toEqual({ insert: "«текст»", caretOffset: 7 });
expect(resolveRussianQuoteEdit("«текст", "", "»")).toEqual({ insert: "", caretOffset: 1 });
```

- [ ] **Шаг 2: реализовать чистую модель и Tiptap `handleTextInput`**

Extension обрабатывает только `text === '"'`, получает before/selected/after из ProseMirror document и selection, делает одну transaction с указанной вставкой и устанавливает `TextSelection` по `caretOffset`. Paste/input другого текста возвращает `false`.

`RussianQuotesExtension.test.ts` поднимает реальный Tiptap editor-core, вызывает `handleTextInput`/browser input для открывающей, закрывающей и выделенной кавычки и проверяет итоговые `text/html/doc`; это закрывает пробел characterization-теста, где `EditorField` замокан.

- [ ] **Шаг 3: подключить только разрешённые поля**

До подключения extension добавить `ScenarioTextTargetKey` и перевести только `additional_comment` («В кадре») с внутреннего `textarea` на `EditorCoreField`, синхронизируя `row.additional_comment` и `row.rich_text.targets.additional_comment`. `setRichText` принимает все пять text targets, а formatting `activate/applySelection` по-прежнему только `FormatTargetKey`: «В кадре» не появляется в toolbar форматирования. После этого один extension покрывает все пять разрешённых prose-полей; file/timecode inputs не меняются.

- [ ] **Шаг 4: проверить integration и undo**

Characterization-тест вводит кавычки в основной текст и «В кадре», подтверждает `«текст»`, проверяет отсутствие преобразования в имени файла и undo всей операции одной кнопкой. Paste прямых кавычек остаётся прямым.

- [ ] **Шаг 5: прогнать тесты и закоммитить**

Run: `cd frontend && npm test -- --run src/features/editor-core/russianQuotes.test.ts src/features/editor-core/RussianQuotesExtension.test.ts src/pages/__tests__/EditorPage.characterization.test.tsx`

Run: `cd frontend && npm run build`

```bash
git add frontend/src/features/editor-core/russianQuotes.ts frontend/src/features/editor-core/russianQuotes.test.ts frontend/src/features/editor-core/RussianQuotesExtension.ts frontend/src/features/editor-core/RussianQuotesExtension.test.ts frontend/src/features/editor-core/extensions.ts frontend/src/features/scenario/scenarioTableModel.ts frontend/src/features/scenario/components/ScenarioRow.tsx frontend/src/pages/__tests__/EditorPage.characterization.test.tsx
git commit -m "feat(editor): type Russian smart quotes"
```

### Task 9: Добавить Franklin Gothic Book в разрешённый font pipeline

**Файлы:**

- Create: `frontend/src/features/editor-core/fontRegistry.ts`
- Create: `frontend/src/features/editor-core/fontRegistry.test.ts`
- Modify: `frontend/src/features/scenario/scenarioTableModel.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioRow.tsx`
- Modify: `frontend/src/features/history/semanticScenarioDiff.ts`
- Modify: `frontend/src/features/history/components/ScenarioSessionDiff.tsx`
- Modify: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`
- Modify: `frontend/src/features/history/semanticScenarioDiff.test.ts`
- Modify: `backend/app/services/scenario_docx_renderer.py`
- Modify: `backend/tests/test_scenario_docx_renderer.py`
- Modify: `backend/tests/test_render_synthetic_scenario_docx.py`
- Modify: `docs/LOCAL_DEV_WORKFLOW_RU.md`
- Modify: `docs/product-reset/PROGRESS.md`

**Интерфейсы:**

- Produces: `EDITOR_FONT_FAMILIES`, `isAllowedEditorFont(value)` и `editorFontCssStack(value)` в едином frontend registry.
- Produces: точное сохраняемое семейство `Franklin Gothic Book` и CSS stack `"Franklin Gothic Book", Arial, sans-serif`.
- Produces: точное семейство в backend `ALLOWED_FONTS`.

- [ ] **Шаг 1: написать RED frontend/backend-тесты**

Frontend registry принимает ровно разрешённые имена, возвращает безопасный CSS stack, option присутствует, выбор сохраняет только `font_family: "Franklin Gothic Book"`, semantic diff не санитизирует его в PT Sans. Backend: paragraph/run DOCX получают `w:ascii`, `w:hAnsi`, `w:eastAsia`, `w:cs` равными Franklin Gothic Book, включая italic run.

- [ ] **Шаг 2: подтвердить RED**

Run: `cd frontend && npm test -- --run src/features/editor-core/fontRegistry.test.ts src/pages/__tests__/EditorPage.characterization.test.tsx src/features/history/semanticScenarioDiff.test.ts`

Run: `cd backend && pytest -q tests/test_scenario_docx_renderer.py tests/test_render_synthetic_scenario_docx.py`

- [ ] **Шаг 3: расширить оба allowlist без font assets**

Добавить точную строку семейства в registry и backend allowlist; `scenarioTableModel` может реэкспортировать массив для совместимости. `ScenarioRow` и history-view используют только `editorFontCssStack`, а в данных остаётся точное имя. Не создавать `@font-face`, не копировать `.ttf` в repository и не менять fallback по умолчанию PT Sans. В local workflow указать, что для визуальной проверки шрифт должен быть установлен в ОС, а после установки браузер перезапущен.

- [ ] **Шаг 4: проверить локальный системный шрифт**

На Mac подтвердить Regular и Italic через системный font match/Font Book и вручную выбрать семейство в локальном редакторе. Зафиксировать в PROGRESS только локальную проверку; Windows/Alt Linux оставить pending.

- [ ] **Шаг 5: прогнать тесты и закоммитить**

Run: `cd frontend && npm test -- --run src/features/editor-core/fontRegistry.test.ts src/pages/__tests__/EditorPage.characterization.test.tsx src/features/history/semanticScenarioDiff.test.ts`

Run: `cd backend && pytest -q tests/test_scenario_docx_renderer.py tests/test_render_synthetic_scenario_docx.py`

```bash
git add frontend/src/features/editor-core/fontRegistry.ts frontend/src/features/editor-core/fontRegistry.test.ts frontend/src/features/scenario/scenarioTableModel.ts frontend/src/features/scenario/components/ScenarioRow.tsx frontend/src/features/history/semanticScenarioDiff.ts frontend/src/features/history/components/ScenarioSessionDiff.tsx frontend/src/pages/__tests__/EditorPage.characterization.test.tsx frontend/src/features/history/semanticScenarioDiff.test.ts backend/app/services/scenario_docx_renderer.py backend/tests/test_scenario_docx_renderer.py backend/tests/test_render_synthetic_scenario_docx.py docs/LOCAL_DEV_WORKFLOW_RU.md docs/product-reset/PROGRESS.md
git commit -m "feat(editor): allow Franklin Gothic Book"
```

### Task 10: Создать индекс поиска и единый реестр prose-полей

**Файлы:**

- Create: `frontend/src/features/editor-core/richTextOperations.ts`
- Create: `frontend/src/features/editor-core/richTextOperations.test.ts`
- Create: `frontend/src/features/editor-core/SearchHighlightExtension.ts`
- Create: `frontend/src/features/editor-core/SearchHighlightExtension.test.ts`
- Create: `frontend/src/features/scenario/scenarioTextFields.ts`
- Create: `frontend/src/features/scenario/scenarioTextFields.test.ts`
- Create: `frontend/src/features/scenario/scenarioSearch.ts`
- Create: `frontend/src/features/scenario/scenarioSearch.test.ts`
- Modify: `frontend/src/features/editor-core/EditorField.tsx`
- Modify: `frontend/src/features/editor-core/extensions.ts`
- Modify: `frontend/src/features/scenario/components/ScenarioRow.tsx`

**Интерфейсы:**

```ts
export type ScenarioProseTarget = ScenarioTextTargetKey;
export interface ScenarioTextFieldId { segmentUid: string; target: ScenarioProseTarget }
export interface ScenarioTextFieldController {
  focusRange(from: number, to: number): void;
  setSearchHighlights(ranges: Array<{ from: number; to: number; active: boolean }>): void;
}
export interface ScenarioSearchMatch extends ScenarioTextFieldId {
  from: number;
  to: number;
  ordinal: number;
}
export function readScenarioProse(row: ScenarioRow, target: ScenarioProseTarget): string;
export function findScenarioMatches(rows: ScenarioRow[], query: string, matchCase: boolean): ScenarioSearchMatch[];
export function replaceScenarioMatches(rows: ScenarioRow[], matches: ScenarioSearchMatch[], replacement: string): ScenarioRow[];
```

- [ ] **Шаг 1: написать RED-тесты области и matching**

Проверить порядок row → target, case-insensitive default, case-sensitive option, несколько совпадений, Unicode Cyrillic, пустой query и отсутствие совпадений в `file_name`, `tc_in`, `tc_out`, title/rubric.

- [ ] **Шаг 2: реализовать чистое чтение prose и search index**

Для SNH разбирать `speaker_text` тем же правилом, что `ScenarioRow.targetText`; для geo читать `structured_data.geo`; для additional comment — поле напрямую. `ordinal` назначать после полного deterministic обхода.

- [ ] **Шаг 3: реализовать чистую rich-text replacement**

`richTextOperations.ts` преобразует plain offsets в ProseMirror positions проходом по text nodes и hardBreak/paragraph boundaries. Для каждого поля ranges применяются с конца одной transaction к документу, созданному из текущего `doc` через ту же schema editor-core. Из результата строятся согласованные `doc/html/text`; replacement наследует marks позиции начала совпадения, а неперекрытый текст сохраняет свои marks. `replaceScenarioMatches` группирует matches по row/target и возвращает полностью готовый новый массив строк без живых editor commands.

- [ ] **Шаг 4: проверить сохранение rich-text marks**

В `richTextOperations.test.ts` взять doc с bold `"Красный"` и plain `"текст"`, заменить совпадение внутри bold, проверить, что replacement сохраняет bold mark, а соседний plain node остаётся без mark. Добавить совпадение на границе двух marks и multiline/hardBreak; подтвердить согласованность `text/html/doc` без plain-text пересборки всего поля.

- [ ] **Шаг 5: добавить только UI-controller для focus и decorations**

`SearchHighlightExtension` хранит `DecorationSet` в plugin state и предоставляет commands установки/очистки обычных и active ranges; decorations не сериализуются в `html/doc`. Реальный extension-тест проверяет классы обычного/active совпадения и неизменность `getJSON()/getHTML()`. `EditorCoreField` при регистрации формирует `ScenarioTextFieldController` для `focusRange` и highlights. `ScenarioRow` передаёт controller родителю для каждого из пяти Tiptap-полей.

- [ ] **Шаг 6: прогнать тесты и закоммитить**

Run: `cd frontend && npm test -- --run src/features/editor-core/richTextOperations.test.ts src/features/editor-core/SearchHighlightExtension.test.ts src/features/scenario/scenarioTextFields.test.ts src/features/scenario/scenarioSearch.test.ts`

Run: `cd frontend && npm run build`

```bash
git add frontend/src/features/editor-core/richTextOperations.ts frontend/src/features/editor-core/richTextOperations.test.ts frontend/src/features/editor-core/SearchHighlightExtension.ts frontend/src/features/editor-core/SearchHighlightExtension.test.ts frontend/src/features/editor-core/EditorField.tsx frontend/src/features/editor-core/extensions.ts frontend/src/features/scenario/scenarioTextFields.ts frontend/src/features/scenario/scenarioTextFields.test.ts frontend/src/features/scenario/scenarioSearch.ts frontend/src/features/scenario/scenarioSearch.test.ts frontend/src/features/scenario/components/ScenarioRow.tsx
git commit -m "feat(editor): index searchable scenario text"
```

### Task 11: Реализовать панель «Найти и заменить» и атомарную замену

**Файлы:**

- Create: `frontend/src/features/scenario/components/ScenarioSearchPanel.tsx`
- Create: `frontend/src/features/scenario/components/ScenarioSearchPanel.test.tsx`
- Modify: `frontend/src/features/scenario/components/ScenarioEditor.tsx`
- Modify: `frontend/src/features/scenario/components/ScenarioRow.tsx`
- Modify: `frontend/src/features/scenario/ScenarioEditor.autosave.test.tsx`
- Modify: `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`
- Modify: `frontend/e2e/editor-characterization.spec.ts`
- Modify: `frontend/src/styles/scenario.css`

**Интерфейсы:**

- Consumes: `findScenarioMatches`, `replaceScenarioMatches`, `ScenarioTextFieldController`, history-aware `mutate`.
- Produces: controlled panel props `query`, `replacement`, `matchCase`, `activeIndex`, `matches`, `mode: "find" | "replace"` и callbacks navigation/replace/close.

- [ ] **Шаг 1: написать RED component-тест панели**

Проверить Russian labels, initial focus query input, `1 из N`, previous/next с циклическим переходом, checkbox регистра, disabled Replace при отсутствии match, disabled Replace All при пустом query и `Escape` close/focus return.

- [ ] **Шаг 2: реализовать stateless UI панели**

Панель располагается в sticky toolbar, не является modal, имеет `role="search"`. Кнопки имеют точные имена: «Предыдущее совпадение», «Следующее совпадение», «Заменить», «Заменить всё», «Закрыть поиск».

- [ ] **Шаг 3: подключить keyboard lifecycle и active match**

`Cmd/Ctrl+F` открывает find и предотвращает браузерный поиск; `Cmd/Ctrl+H` открывает replace; `Escape` закрывает. После пересчёта matches activeIndex clamp/cycle. Выбор совпадения вызывает соответствующий зарегистрированный controller `focusRange` и прокручивает поле через `scrollIntoView({ block: "center" })` без потери sticky toolbar.

- [ ] **Шаг 4: реализовать Replace и Replace All**

Одиночный Replace делает один `mutate(current => replaceScenarioMatches(current, [activeMatch], replacement), { kind: "replace" })`. Replace All вызывает `mutate(current => replaceScenarioMatches(current, matches, replacement), { kind: "replace-all" })`. Поэтому операция имеет одну history-запись и один `autosave.scheduleSave`; живые editor commands не создают промежуточных rows.

- [ ] **Шаг 5: закрепить autosave/history/rich text integration**

Тесты проверяют: замена только prose; форматирование вокруг совпадения; `Cmd+Z` целиком отменяет Replace All; один save payload содержит все замены; ошибка save оставляет локальный заменённый текст и undo history; file/timecodes не меняются.

- [ ] **Шаг 6: добавить browser flow**

Playwright вводит query, проходит next/previous, меняет регистр, выполняет Replace All в нескольких строках, проверяет подсветку/active match и затем Undo. На 1366 и 1920 toolbar не перекрывает активное поле.

- [ ] **Шаг 7: прогнать тесты и закоммитить**

Run: `cd frontend && npm test -- --run src/features/scenario/components/ScenarioSearchPanel.test.tsx src/features/scenario/scenarioSearch.test.ts src/features/scenario/ScenarioEditor.autosave.test.tsx src/pages/__tests__/EditorPage.characterization.test.tsx`

Run: `cd frontend && npm run test:e2e -- --project=chromium-1366 --project=chromium-1920 e2e/editor-characterization.spec.ts`

```bash
git add frontend/src/features/scenario/components/ScenarioSearchPanel.tsx frontend/src/features/scenario/components/ScenarioSearchPanel.test.tsx frontend/src/features/scenario/components/ScenarioEditor.tsx frontend/src/features/scenario/components/ScenarioRow.tsx frontend/src/features/scenario/ScenarioEditor.autosave.test.tsx frontend/src/pages/__tests__/EditorPage.characterization.test.tsx frontend/e2e/editor-characterization.spec.ts frontend/src/styles/scenario.css
git commit -m "feat(editor): find and replace scenario text"
```

### Task 12: Показать одноразовое окно «Что нового» для v1.2.0

**Файлы:**

- Create: `frontend/src/features/release-notes/releaseNotes.ts`
- Create: `frontend/src/features/release-notes/releaseNotes.test.ts`
- Create: `frontend/src/features/release-notes/WhatsNewDialog.tsx`
- Create: `frontend/src/features/release-notes/WhatsNewDialog.test.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.test.tsx`
- Modify: `frontend/src/styles/layout.css`
- Modify: `frontend/e2e/editorial-air.spec.ts`

**Интерфейсы:**

```ts
export interface ReleaseNote {
  version: string;
  title: string;
  intro: string;
  items: string[];
}
export const RELEASE_NOTES: Readonly<Record<string, ReleaseNote>>;
export function releaseNoteStorageKey(userId: number, version: string): string;
```

- [ ] **Шаг 1: написать RED-тест registry и storage key**

Проверить точные данные `1.2.0`, отсутствие fallback для неизвестной версии и разные ключи для двух пользователей/версий. Ожидания задать литералами, не вычислять через production helper.

- [ ] **Шаг 2: подтвердить RED и реализовать минимальный registry**

Run: `cd frontend && npm test -- --run src/features/release-notes/releaseNotes.test.ts`

Expected: FAIL, module отсутствует. Затем добавить типизированную запись `1.2.0` с утверждённым заголовком, intro и пятью короткими пользовательскими пунктами; повторный запуск PASS.

- [ ] **Шаг 3: написать RED component-тесты модального lifecycle**

Проверить: первый показ; отсутствие после сохранённой отметки; повторный показ для другого user/version; закрытие кнопкой «Продолжить работу», `Escape` и backdrop; клик внутри не закрывает; начальный focus и Tab trap; восстановление предыдущего focus; ошибка getItem/setItem не ломает AppShell и позволяет закрыть окно на текущем mount.

- [ ] **Шаг 4: реализовать доступный `WhatsNewDialog`**

Компонент получает `userId`, `version`, `releaseNote` и `onDismiss`. При mount безопасно читает ключ `newscast:whats-new:<user-id>:<version>`. Если запись отсутствует, рендерит overlay/dialog; любой утверждённый способ закрытия сначала скрывает окно в React state, затем best-effort пишет `"seen"`. Если release note для версии нет, возвращает `null`.

Dialog следует существующим focus-trap паттернам проекта, имеет `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, список `<ul>` и единственную основную кнопку «Продолжить работу». Внешний click определяется сравнением `event.target === event.currentTarget`.

- [ ] **Шаг 5: подключить к authenticated `AppShell`**

`AppShell` импортирует `APP_VERSION`, выбирает `RELEASE_NOTES[APP_VERSION]` и рендерит dialog после shell content, передавая `user.id`. Существующие AppShell-тесты очищают/задают localStorage явно, чтобы modal не скрывал проверяемую навигацию.

- [ ] **Шаг 6: добавить browser-проверку финальной версии**

В `editorial-air.spec.ts` очистить storage перед первым authenticated load, проверить заголовок/пять пунктов, focus кнопки, закрытие и ключ `newscast:whats-new:<user-id>:1.2.0`; после reload dialog отсутствует. Второй контекст с пустым storage снова получает dialog.

- [ ] **Шаг 7: прогнать тесты и закоммитить**

Run: `cd frontend && npm test -- --run src/features/release-notes/releaseNotes.test.ts src/features/release-notes/WhatsNewDialog.test.tsx src/components/app-shell/AppShell.test.tsx`

Run: `cd frontend && npm run build`

```bash
git add frontend/src/features/release-notes/releaseNotes.ts frontend/src/features/release-notes/releaseNotes.test.ts frontend/src/features/release-notes/WhatsNewDialog.tsx frontend/src/features/release-notes/WhatsNewDialog.test.tsx frontend/src/components/app-shell/AppShell.tsx frontend/src/components/app-shell/AppShell.test.tsx frontend/src/styles/layout.css frontend/e2e/editorial-air.spec.ts
git commit -m "feat(shell): show v1.2.0 release notes"
```

### Task 13: Оформить v1.2.0 и провести финальный локальный rehearsal

**Файлы:**

- Modify: `backend/pyproject.toml`
- Modify: `backend/app/core/version.py`
- Modify: `backend/tests/test_app_version.py`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/src/components/AppFooter.test.tsx`
- Modify: `frontend/src/components/app-shell/AppShell.test.tsx`
- Modify: `CHANGELOG.md`
- Modify: `docs/product-reset/PROGRESS.md`
- Modify: `docs/LOCAL_DEV_WORKFLOW_RU.md` только если фактические команды отличаются от документа

**Интерфейсы:**

- Produces: единая application version `1.2.0`.
- Produces: локальный проверенный release candidate без tag/deploy.

- [ ] **Шаг 1: обновить version expectation и подтвердить RED**

Run: `cd backend && pytest -q tests/test_app_version.py`

Expected: FAIL на текущем `1.1.2`.

- [ ] **Шаг 2: механически обновить manifests и footer-тесты до `1.2.0`**

Не менять исторические разделы `PROGRESS.md` и design docs. Новый раздел `Версия 1.2.0 — инструменты редактора` помещается выше `1.1.2` и содержит commit/evidence, Mac checks, `NOT DEPLOYED`, pending Windows/Alt Linux. В `CHANGELOG.md` добавить `[1.2.0] - 2026-08-23` с новыми редакторскими функциями.

- [ ] **Шаг 3: выполнить полный автоматический gate**

Run: `cd backend && pytest -q`

Run: `cd frontend && npm test -- --run`

Run: `cd frontend && npm run build`

Run: `docker compose -f compose.yaml config`

Run: `cd frontend && npm run test:e2e -- --project=chromium-1366 --project=chromium-1920 --project=chromium-2560-layout`

Run: `git diff --check`

Expected: PASS без skipped обязательных тестов и без новой миграции.

- [ ] **Шаг 4: выполнить чистый локальный Compose rehearsal**

Провести inventory deploy/migration/backup/restore/CI/seed/smoke/recovery файлов как `KEEP/ADAPT/REPLACE/DELETE`; поскольку контракты deploy не меняются, любые изменения вне документации должны быть отдельно обоснованы. Поднять текущую ветку локально с чистой synthetic PostgreSQL, проверить health, synthetic seed, authenticated smoke и остановить локальный stack.

- [ ] **Шаг 5: выполнить ручную Mac-проверку фактического UI**

На `127.0.0.1:5173` проверить:

- `+` с основного ряда и обычный `=`;
- первый показ и повторное скрытие окна «Что нового»;
- шапку 1366/1920/2560 и home link;
- уведомления от второго synthetic session без reload;
- Franklin Gothic Book Regular/Italic;
- открывающие/закрывающие `«»` при русской раскладке;
- drag мышью и кнопки ↑/↓;
- undo/redo для текста, форматирования, блока, файла и Replace All;
- find/replace с форматированным текстом;
- DOCX export с Franklin Gothic и открытие локального результата.

- [ ] **Шаг 6: провести два независимых code-review прохода**

Первый проход: соответствие обеим спецификациям и продуктовой модели. Второй: качество кода, race/autosave, accessibility и тестовые пробелы. Исправления проходят свой RED/GREEN цикл; после них повторить scoped и полный gate.

- [ ] **Шаг 7: создать финальный локальный release-candidate коммит**

```bash
git add backend/pyproject.toml backend/app/core/version.py backend/tests/test_app_version.py frontend/package.json frontend/package-lock.json frontend/src/components/AppFooter.test.tsx frontend/src/components/app-shell/AppShell.test.tsx CHANGELOG.md docs/product-reset/PROGRESS.md docs/LOCAL_DEV_WORKFLOW_RU.md
git commit -m "chore(release): prepare v1.2.0 editor tools"
```

- [ ] **Шаг 8: зафиксировать границу передачи владельцу**

Сообщить точную ветку, HEAD, список локальных commits, результаты тестов, Compose/manual evidence и оставшиеся риски. Не выполнять push, PR, merge, tag или production deploy. Отдельно запросить разрешение только на следующий внешний релизный этап.

---

## Матрица покрытия спецификаций

| Требование | Основная задача | Финальная проверка |
|---|---:|---|
| Одиночный `+` | 1 | 4, 13 |
| Ограниченная шапка | 2 | 4, 13 |
| Identity → главная | 2 | 4, 13 |
| Polling 5 секунд | 3 | 4, 13 |
| Закрытие tray вне/Escape | 3 | 4, 13 |
| Scenario-wide undo/redo | 5–6 | 13 |
| Drag blocks | 7 | 13 |
| Русские `«ёлочки»` | 8 | 13 |
| Franklin Gothic Book | 9 | 13 |
| Find/replace | 10–11 | 13 |
| Окно «Что нового» | 12 | 13 |
| Один актуальный сценарий и autosave | 5–11 | 13 |
| Windows/Alt Linux field validation | Не выполняется локально | Явно pending в 4 и 13 |
| Обратный импорт DOCX | Исключён | Не должен появиться в diff |

## Критерий завершения общей цели

Общая цель завершена, когда ветка содержит последовательные локальные checkpoints `v1.1.2` и `v1.2.0`, полный доступный автоматический gate зелёный, фактический UI и DOCX проверены на MacBook, `PROGRESS.md` отражает evidence и ограничения, а production deploy не выполнялся. Недоступные Windows/Alt Linux проверки остаются отдельным обязательным post-deploy field gate.
