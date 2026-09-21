# Список сюжетов и редактор — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Выполнять в этой задаче; не запускать субагентов без отдельного основания.

**Goal:** Показать в списке только имя автора, перенести его смену в карточку, показывать только монтажёра/дизайнера, добавить ввод U+2013 и прямых кавычек, сделать default GEO жирным курсивом без регрессии редактора.

**Architecture:** React-компонент карточки использует существующий management API. Маленькое ProseMirror-расширение обрабатывает физические клавиши, а нынешний RussianQuotesExtension сохраняет контекстную обработку остальных кавычек. Все изменения текста проходят через существующие editor-core → scenario history → ack-only autosave.

**Tech Stack:** React 18, TypeScript, Tiptap 3/ProseMirror, Vitest, Playwright; без новых production-зависимостей.

**Spec:** `REQUIREMENTS_RU.md` в этом каталоге; `../../design/DESIGN_CHECKPOINT_RU.md`.

**Статус:** проект плана на согласование, не разрешение реализации. Подтверждены U+2013, перенос смены автора внутрь карточки для начальника и шеф-редактора, ограничение исполнителей и жирный курсив GEO. Alt/Option + минус и подробности прямых кавычек предложены агентом; подтвердить в общем согласовании плана. База анализа: main, d7a0300f8e68e24c7dd5aafb8a9ce02bf48df26f.

## Global Constraints

- До кода перечитать AGENTS.md, SPEC_RU.md, EVAL_RUBRIC_RU.md, IMPLEMENTATION_PLAN_RU.md, GOAL_PROMPTS_RU.md; сверить текущую ветку и изменения относительно базы анализа.
- После утверждения создать отдельную ветку/worktree. Не менять main, не push/PR/merge/deploy.
- Один актуальный сценарий; UI-состояние ввода главнее ack. Не переинициализировать таблицу или Tiptap после смены автора либо сохранения символа.
- Синяя шапка, пять столбцов, rich text, TC, CaptionPanels, общий undo/redo и существующие роли сохраняются.
- Не редактировать эталоны approved-baseline, их manifests или существующий ZIP. Новые требования имеют приоритет над старым снимком поведения автора.
- Backend меняется только для default GEO в DOCX; перепроектирования API, migrations, MUI-инсталляции или изменения CaptionPanels нет.
- Все новые данные тестов синтетические. Время, указанные версии и состояние окружения перепроверять перед запуском.

## Checkpoint A — статичный автор в списке и управление в карточке

**Файлы:**
- Create `frontend/src/features/stories/components/StoryAuthorControl.tsx` — доступная кнопка «Изменить», загрузка server permissions, диалог выбора автора и вызов существующего API.
- Create `frontend/src/features/stories/StoryAuthorControl.test.tsx` — права, ошибки, повтор, pending, устаревшие ответы и смена сюжета.
- Modify `frontend/src/features/stories/components/StoryHeader.tsx` — расширить минимальный тип story полем id и принять callback изменения автора; подключить новый контроль. При внедрении общего нового header объединить с его «Изменить», не плодить две кнопки.
- Modify `frontend/src/pages/StoryScenarioPage.tsx`, `StoryProductionPage.tsx`, `StoryHistoryPage.tsx` — принять подтверждённого автора и освежить связанные read-models, не сбрасывая локальный редактор.
- Modify `frontend/src/features/scenario/components/ScenarioEditor.tsx` — необязательный счётчик `workflowRefreshKey`, меняющий только загрузку workflow после смены автора, не effect загрузки сценария/lease/history.
- Modify `frontend/src/features/stories/components/StoriesTable.tsx` — удалить `onAuthorChange` и всю ветку select, оставить имя.
- Modify `frontend/src/pages/StoriesPage.tsx` — удалить `changeAuthor` и передачу prop; `changeManagement` и `changePriority` сохранить.
- Modify `frontend/src/styles/stories.css` — удалить только `.story-author-select`, добавить стили диалога/текстовой кнопки в текущей системе.
- Modify `frontend/src/features/stories/StoriesTable.test.tsx`, `StoryManagement.test.tsx` — заменить ожидания select, сохранив проверки рубрик и прав.
- Modify `frontend/e2e/story-management.spec.ts` — реальный пользовательский путь смены автора через карточку; проверки списка, ошибки, приоритета и рубрик.
- Modify `frontend/src/pages/StoryScenarioPage.handoff.test.tsx` — смена автора не размонтирует открытый сценарий и не смешивает ответы разных storyId.
- Keep `frontend/src/features/stories/api.ts`, shared contracts и backend management endpoint: использовать существующие контракты, не удалять `author_options` или право менять автора.

**Интерфейс нового контроля:**

```ts
interface StoryAuthorControlProps {
  storyId: number;
  author: UserRef;
  management?: StoryManagementState | null;
  onAuthorChanged: (author: UserRef) => void;
}
```

`management=null` — сервер запретил управление, контроль не показывается. `undefined` — компактный production-header не несёт management; компонент получает разрешение через `fetchStory(storyId)`, не вычисляя роли по должности. На открытии диалога освежить canonical story и варианты, чтобы не использовать старое разрешение. Ошибка загрузки допускает повтор и не раскрывает управление без server permission.

Контроль доступен обеим серверным leadership-функциям chief и chief_editor (начальник и шеф-редактор), не только chief. Внутри «Изменить» — поле «Автор», явные «Применить»/«Отмена». Это значимое изменение владельца сюжета, а не регулярная операция с исполнителями; не применять без выбора и подтверждения. Запрос использует `updateStoryManagement(serverAction, {author_user_id})`. Выбор неизменённого id не отправляется. При 403/409/сети диалог остаётся с выбранным значением и сообщением; никакого ложного успеха. При успехе canonical read-model перечитывается; из него передаётся только новый `author`, а не весь объект поверх локальных метаданных.

Диалог: роль dialog, aria-modal, label «Изменить автора», клавиатура/Tab внутри, Escape и возврат фокуса при отмене; pending защищён от второго PATCH. Ответы имеют guard на captured storyId, поколение запроса и unmount; результат старого сюжета не меняет новый.

- [ ] Сначала добавить failing-тест статичного столбца для обычного пользователя, начальника и шеф-редактора, включая автора вне `author_options` и fallback `username`:

```tsx
render(<StoriesTable items={[story]} onOpenScenario={vi.fn()} />);
const row = screen.getByRole('row', { name: /Синтетический выпуск/ });
const authorCell = within(row).getAllByRole('cell')[3];
expect(authorCell).toHaveTextContent(/^Тест$/);
expect(within(authorCell).queryByRole('combobox')).not.toBeInTheDocument();
expect(within(authorCell).queryByRole('button')).not.toBeInTheDocument();
expect(authorCell).not.toHaveTextContent('Корреспондент');
```

Тест использует существующую fixture `story` из StoriesTable.test.tsx; добавить импорт `within`.

- [ ] Добавить тесты нового контроля: management null; успешный PATCH отдельно для chief и chief_editor; пустое имя; действующий автор вне доступных вариантов; выбор без изменения; ошибка и повтор; двойное нажатие; storyId меняется до ответа; запрос в карточке не делает PUT строк сценария.
- [ ] Запустить `cd frontend && npm run test -- --run src/features/stories/StoriesTable.test.tsx src/features/stories/StoryAuthorControl.test.tsx` и подтвердить ожидаемые failures на старом коде.
- [ ] Реализовать новый контроль в общей шапке. В ScenarioPage callback меняет только `story.author` и увеличивает workflowRefreshKey; в production — обновляет author и вызывает текущий `refreshProduction` с уже существующими generation guards; в history — обновляет author и текущую выборку событий без сброса выбранного сравнения.
- [ ] Добавить отдельный effect на workflowRefreshKey в ScenarioEditor: при изменении только `loadWorkflow()`. Не включать ключ в зависимости effect, сбрасывающего rows, snapshot, search, history или lease.
- [ ] Заменить авторскую ячейку и удалить obsolete UI:

```tsx
<td>{story.author.display_name.trim() || story.author.username}</td>
```

Удалить callback `changeAuthor`, prop `onAuthorChange` и `.story-author-select`. Не удалять API и формы выбора автора при создании.

- [ ] Перенести e2e ожидания PATCH из select списка в «открыть карточку → Изменить → Автор → Применить». Сохранить сценарии рубрик, priority error/retry и ordinary user. После возврата в список виден новый display_name, должности и select нет; после reload автор тот же.
- [ ] Проверить сценарий с незавершённым локальным текстом: открыть/закрыть диалог и сменить автора, дождаться ack, текст/selection/scroll/undo сохранены, workflow обновился без перезагрузки Tiptap.
- [ ] Выполнить релевантные тесты и общий набор из раздела проверок; обновить PROGRESS.md. Локальный commit после проверки: `feat(stories): move author editing into story card`.

## Checkpoint B — точный ввод среднего тире и прямых кавычек

**Файлы:**
- Create `frontend/src/features/editor-core/typographyKeyboard.ts` — чистое распознавание клавиш.
- Create `frontend/src/features/editor-core/typographyKeyboard.test.ts` — матрица физической клавиши/раскладки/modifiers/composition.
- Create `frontend/src/features/editor-core/TypographyKeyboardExtension.ts` и `.test.ts` — операции с реальным Tiptap/ProseMirror, marks, selection, readonly и ровно один update.
- Modify `frontend/src/features/editor-core/extensions.ts` — зарегистрировать новое расширение перед RussianQuotesExtension.
- Modify `frontend/src/features/editor-core/russianQuotes.ts` и `.test.ts` — U+2013 в открывающем контексте.
- Modify `frontend/src/features/editor-core/RussianQuotesExtension.ts` — guard readonly/composition в текущем text-input handler; остальная логика умных кавычек сохраняется.
- Modify `frontend/src/features/editor-core/RussianQuotesExtension.test.ts` — direct quote exception через keydown и прежний smart fallback; paste не меняется.
- Modify `frontend/src/features/scenario/ScenarioEditor.boundary.test.tsx` только при необходимости проверить формат payload/границы общей истории; не заменять реальный editor-core mock-тестом.
- Create `frontend/e2e/editor-typography.spec.ts` — интеграция с текущими synthetic API и настоящим contenteditable.
- Modify `backend/tests/test_scenario_docx_renderer.py` и `backend/tests/test_captionpanels_current_scenario.py` — точное сохранение U+2013, дефиса и ASCII quote в экспортируемом контенте; изменения production backend в этом checkpoint не нужны; default GEO меняется отдельно в checkpoint D.

**Чистый интерфейс и целевая реализация:**

```ts
export interface TypographyKey {
  code: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  getModifierState?: (key: string) => boolean;
}

export function resolveTypographyKey(e: TypographyKey): '\u2013' | '"' | null {
  if (e.isComposing || e.ctrlKey || e.metaKey
      || e.getModifierState?.('AltGraph')) return null;
  if (e.code === 'NumpadSubtract' && !e.altKey && !e.shiftKey) return '\u2013';
  if (e.code === 'Minus' && e.altKey && !e.shiftKey) return '\u2013';
  if (e.code === 'Quote' && e.key === '"' && !e.altKey) return '"';
  return null;
}
```

Для Numpad используется code, а не любой key `-`. Для Quote обязательны и code, и полученный `key='"'`, поэтому `Э`, апостроф и `@` не ломаются. `getModifierState` вызывать на исходном событии, не отрывая DOM-метод от `this`.

- [ ] Добавить failing unit-матрицу (пример реальных случаев):

```ts
const base = {code: 'Minus', key: '-', shiftKey: false, altKey: false,
  ctrlKey: false, metaKey: false, isComposing: false};
expect(resolveTypographyKey({...base, code: 'NumpadSubtract'})).toBe('\u2013');
expect(resolveTypographyKey({...base, altKey: true})).toBe('\u2013');
expect(resolveTypographyKey(base)).toBeNull();
expect(resolveTypographyKey({...base, key: '_', shiftKey: true})).toBeNull();
expect(resolveTypographyKey({...base, code: 'Quote', key: '"', shiftKey: true})).toBe('"');
expect(resolveTypographyKey({...base, code: 'Quote', key: 'Э', shiftKey: true})).toBeNull();
expect(resolveTypographyKey({...base, code: 'Digit2', key: '"', shiftKey: true})).toBeNull();
expect(resolveTypographyKey({...base, code: 'Digit2', key: '@', shiftKey: true})).toBeNull();
expect(resolveTypographyKey({...base, altKey: true, isComposing: true})).toBeNull();
expect(resolveTypographyKey({...base, altKey: true, ctrlKey: true})).toBeNull();
expect(resolveTypographyKey({...base, altKey: true, getModifierState: () => true})).toBeNull();
```

Дополнить code пустой/Unidentified, Meta, Shift+NumpadSubtract, апостроф и повторное нажатие.

- [ ] Запустить `cd frontend && npm run test -- --run src/features/editor-core/typographyKeyboard.test.ts`, подтвердить отсутствие нового модуля как ожидаемую причину падения, затем добавить приведённую чистую функцию.
- [ ] Написать тесты на настоящем Editor из существующего createEditorCoreExtensions. Отправлять keydown через `editor.view.someProp('handleKeyDown', handler => handler(editor.view, event))`; отдельно browser-тест проверяет отмену нативной вставки. Для Shift+Digit2/unknown code отдельно вызвать штатный text input `"` и получить `«»`.
- [ ] Реализовать расширение без глобальных window listeners, таймеров или флага «предыдущая клавиша»:

```ts
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { resolveTypographyKey } from './typographyKeyboard';

export const TypographyKeyboardExtension = Extension.create({
  name: 'typographyKeyboard',
  addProseMirrorPlugins() {
    return [new Plugin({props: {
      handleKeyDown(view, event) {
        if (!view.editable || view.composing || event.isComposing) return false;
        const text = resolveTypographyKey(event);
        if (text === null) return false;
        view.dispatch(view.state.tr.insertText(text));
        return true;
      },
    }})];
  },
});
```

ProseMirror сам вызывает preventDefault при true; прямое dispatch не проходит повторно через handleTextInput. `insertText` сохраняет текущие marks и заменяет выделение. Не добавлять scrollIntoView, отдельное setContent или собственную history.

- [ ] Подключить TypographyKeyboardExtension перед RussianQuotesExtension. В начале последнего handleTextInput использовать `if (!view.editable || view.composing || text !== '"') return false;`.
- [ ] В `russianQuotes.ts` добавить U+2013 рядом с U+2014. Точный ожидаемый тест:

```ts
expect(resolveRussianQuoteEdit('Сказал –', '', 'текст')).toEqual({insert: '«»', caretOffset: 1});
expect(resolveRussianQuoteEdit('Сказал —', '', 'текст')).toEqual({insert: '«»', caretOffset: 1});
```

Не удалять существующие 17 случаев контекста, оборачивание выделения и переход за закрывающую кавычку.

- [ ] Проверить real Editor: вставка U+2013 в bold/italic текст, замена выделения, прямой `"` ровно один раз; умные кавычки вокруг форматированного выделения; работа после hardBreak/paragraph; readonly и composition не меняют документ; paste `"x" - – —` сохраняется побуквенно.
- [ ] E2E: основной текст, гео, ФИО/должность и «В кадре»; input файлов/TC/синей шапки не меняет семантику; один keydown не порождает `–-` или `"«»`; дефис остаётся в `что-то`; прямые кавычки остаются в `12"`; среднее тире не превращается обратно при ack и reload. Отдельная операция undo/redo проверяется на изолированном изменении без переписывания общей логики группировки набора.
- [ ] Для RU Shift+Digit2 автоматический браузерный тест должен задавать code/key осознанно; обычный Playwright Shift+Digit2 на EN даёт `@`. Synthetic dispatch не считать доказательством системной раскладки.
- [ ] Проверить DOCX через текст XML внутри ZIP, CaptionPanels через JSON: `что-то – "пример"` сохраняет U+002D/U+2013/U+0022. Содержимое не заменять regex-нормализацией на экспорте.
- [ ] Выполнить проверки ниже, обновить PROGRESS.md, локальный commit `feat(editor): add en dash shortcut and literal quote input`.

## Checkpoint C — исполнители главного списка

**Файлы:**
- Modify `frontend/src/features/stories/components/StoriesTable.tsx`: assigneeSummary.
- Modify `frontend/src/features/stories/StoriesTable.test.tsx`: канонический kind и комбинации ролей.
- Modify `frontend/e2e/story-management.spec.ts`: отображение chief/chief_editor и колонка исполнителей в списке/архиве.
- Keep backend assignments, production page и read models: корректор остаётся назначенным.

- [ ] До правки написать тесты на три назначения; только корректора; только монтажёра; только дизайнера; отсутствие; произвольный порядок; одинаковый человек в двух ролях; пользовательская должность, не совпадающая с ролью. Все проверки scoped к ячейке «Исполнители», чтобы не задеть колонку автора.
- [ ] Исправить fixture kind `video` → `video_editor`, затем воспроизвести отсутствие нужных имён при трёх assignments на старом assigneeSummary.
- [ ] Заменить summary на фильтрацию канонических ролей:

```ts
function assigneeSummary(item: StoryListItem): string {
  const roles = [
    {kind: 'video_editor', label: 'Монтажёр'},
    {kind: 'designer', label: 'Дизайнер'},
  ];
  const parts = roles.flatMap(({kind, label}) => {
    const assignment = item.assignments.find(value => value.kind === kind);
    if (!assignment) return [];
    const name = assignment.user.display_name.trim() || assignment.user.username;
    return [`${label}: ${name}`];
  });
  return parts.length ? parts.join(' · ') : 'Не назначены';
}
```

- [ ] Не удалять proofreader из переданного item или API. Проверить, что в «Производстве» корректор всё ещё виден и доступен для назначения.
- [ ] Запустить StoriesTable.test.tsx и согласованные browser-проверки 1366/1920: две длинные подписи не ломают таблицу. Общий набор и PROGRESS.md по AGENTS. Локальный commit `fix(stories): show only video editor and designer in registry`.

## Checkpoint D — жирный курсив GEO, одинаковый в редакторе и DOCX

**Файлы:**
- Modify `frontend/src/features/scenario/scenarioTableModel.ts`: defaultScenarioFormatting.
- Create `frontend/src/features/scenario/scenarioTableModel.test.ts`: default/override/конвертация блока (перед созданием проверить отсутствие файла).
- Modify `frontend/src/pages/__tests__/EditorPage.characterization.test.tsx`: новый GEO и смена типа без потери текста/структуры.
- Modify `frontend/e2e/editor-characterization.spec.ts`: реальный computed style GEO и состояние кнопок форматирования, ручное переопределение и reload.
- Modify `backend/app/services/scenario_docx_renderer.py`: _default_target_style.
- Modify `backend/tests/test_scenario_docx_renderer.py`: стиль GEO, explicit override, остальные типы.
- Keep ScenarioRow, serializers, CSS и CaptionPanels: менять defaults, а не принудительный стиль поверх пользовательского форматирования.

- [ ] Добавить тест на `defaultScenarioFormatting({block_type:'zk_geo'}, 'geo')` с типизированной полноценной fixture ScenarioRow: bold true, italic true. Для target text того же блока — оба false. СНХ/Лайф сохранить как до изменения.
- [ ] Проверить scenarioFormatting с `formatting.targets.geo={bold:false, italic:true}`: explicit override должен остаться false/true. При переходе ЗК → ЗК+гео новый target получает defaults; текст ЗК и file_bundles сохраняются.
- [ ] В backend-тесте собрать snapshot через существующие `_snapshot`/`_row` и render_scenario_docx; у текстовых runs GEO проверить bold=true и italic=true. Отдельный snapshot с overrides сохраняет их.
- [ ] Запустить новые тесты до реализации, получить ожидаемое несовпадение default bold при неизменном italic=true. Затем поменять только defaults:

```ts
const isGeo = row.block_type === 'zk_geo' && target === 'geo';
return {
  font_family: 'PT Sans',
  bold: isGeo || (row.block_type === 'snh' && target !== 'text'),
  italic: row.block_type === 'life' || isGeo || row.block_type === 'snh',
  strikethrough: false,
  fill_color: '#ffffff',
};
```

```python
# _default_target_style: остальные поля DocxRunStyle сохраняются.
bold=(block_type == "zk_geo" and target == "geo") or (block_type == "snh" and target != "text"),
italic=block_type == "life" or (block_type == "zk_geo" and target == "geo") or block_type == "snh",
```

- [ ] Проверить реальный contenteditable нового GEO: computed font-weight 700, font-style italic, без underline; toolbar B и I активны. После ручного отключения B и сохранения/reload выбор сохраняется. Rich-text marks не переписываются глобально. Тесты серверного DOCX и браузера должны согласоваться.
- [ ] Визуально проверить DOCX и редактор на синтетическом GEO, включая перенос строки. Не менять расположение GEO в DOCX: меняется лишь default оформления. Общий набор, PROGRESS.md и локальный commit `fix(editor): default GEO to bold italic in editor and DOCX`.

## Checkpoint E — документация, совместная проверка и приёмка

**Файлы:**
- Modify `docs/product-reset/V1_2_0_EDITOR_TOOLS_DESIGN_RU.md`, раздел 4.2 — оговорить исключение физической Quote и правило тире; пометить дополнение новым согласованием, не объявлять старый релиз изменённым.
- Create `docs/EDITOR_KEYBOARD_RU.md` — пользовательская таблица клавиш, RU/EN, numpad/ноутбук, поля-исключения.
- Modify `docs/README_RU.md` — ссылка на памятку после реализации.
- Modify `docs/product-reset/PROGRESS.md` — реальный результат каждого checkpoint, SHA, команды и платформенные ограничения.
- Modify `artifacts/WORK_ITEMS_RU.md` — статусы исполнения, ссылки на commits/evidence. Не менять готовые дизайн-архивы.

- [ ] В документации явно отличать `- U+002D`, `– U+2013`, `— U+2014` и сослаться на проверенный CaptionPanels utils.jsx.
- [ ] Проверить Windows + RU/EN и Mac + RU/EN: физические клавиши, NumLock on/off, внешняя клавиатура с numpad и ноутбук, Alt/Option + минус, русская Э, английские апостроф/прямая кавычка и `@`. Не менять системную раскладку без пользователя; оформить короткий ручной чек-лист, если машины нет.
- [ ] Проверить keyboard focus диалога и editor, сценарий сохранения/ошибки автора, имя в списке и права обычного пользователя. Переходы по вкладкам и сохранение текста не регрессируют.
- [ ] Пройти общие команды в изолированной ветке:

```bash
cd frontend
npm run test -- --run
npm run build
node node_modules/@playwright/test/cli.js test e2e/story-management.spec.ts e2e/editor-typography.spec.ts e2e/editor-characterization.spec.ts e2e/scenario-autosave.spec.ts e2e/scenario-docx-export.spec.ts --project=chromium-1366 --workers=1
node node_modules/@playwright/test/cli.js test e2e/story-management.spec.ts e2e/editor-typography.spec.ts --project=chromium-1920 --workers=1
```

Отдельно из корня/соответствующего каталога: `cd backend && pytest -q`; `docker compose -f compose.yaml config` в разрешённом локальном dev-окружении без чтения production .env; полный доступный e2e согласно AGENTS. npm ci нужен при подготовке отсутствующих/несогласованных зависимостей, не менять package-lock без причины. После проверок применить предусмотренный проектом review и `git diff --check`. Deployment не входит в этот план.

- [ ] Результат ручных проверок фиксировать отдельно от synthetic e2e; если физические сочетания на одной платформе не проверены, так и указать, не заявлять полную платформенную готовность.
- [ ] После согласования итогов локальный commit документации. Пользователь отдельно решает push/PR/merge/deploy.

## Порядок совместно с дизайном

A и C входят во внедрение общего StoryHeader и списка «Сюжеты». B и D технически независимы от MUI/Paper и могут быть выполнены раньше остального дизайна после утверждения; работать последовательно. E завершает совместную приёмку. Эта запись не запускает реализацию и не изменяет утверждённые макеты; дальнейшие пожелания добавляются отдельными R-id в общий список.

## Проверено при подготовке

32 текущих теста passed; новых сочетаний в runtime ещё нет. Paper-вызовов в этой задаче не было. Исходники CaptionPanels только прочитаны.
