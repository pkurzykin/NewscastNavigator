# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать согласованный UI-редизайн Newscast Navigator: role-aware главный экран, список сюжетов с приоритетами, карточку сюжета с вкладками и аккуратное встраивание текущего редактора без переписывания его ядра.

**Architecture:** Редизайн внедряется слоями: сначала общий layout и визуальные токены, затем презентационная логика списка сюжетов, затем главный экран, затем карточка сюжета. Существующий `EditorPage` и editor-core сохраняются; они постепенно оборачиваются новой структурой карточки, чтобы не сломать рабочие сценарии.

**Tech Stack:** React 18, TypeScript, Vite, текущий CSS без добавления UI-framework, FastAPI backend без изменений на первом этапе.

---

## 0. Source Of Truth

Перед началом реализации прочитать:

- `docs/superpowers/specs/2026-04-29-ui-redesign-concept-design.md`
- `docs/PROJECT_WORKFLOW_ARCHITECTURE_RU.md`
- `docs/BRAND_GUIDELINES_TRANSNEFT_RU.md`
- `docs/ENGINEERING_PLAN_RU.md`
- `docs/WEB_SMOKE_CHECKLIST_RU.md`

Обязательные ограничения:

- не переписывать editor-core первым этапом;
- не менять backend/API без отдельного решения;
- не использовать английские technical labels в пользовательском UI;
- не ломать интеграционные инварианты `CaptionPanels`;
- не добавлять новый UI-framework без отдельного решения.

## 1. Как отслеживать прогресс

Этот план специально разбит на контрольные фазы. После каждой фазы должен быть видимый результат.

Статусы для ручного контроля:

- `[ ]` не начато;
- `[~]` в работе;
- `[x]` сделано;
- `[!]` нужен пересмотр решения.

Основные checkpoints для пользователя:

- Checkpoint A: новый shell/sidebar/profile виден, старые экраны еще работают.
- Checkpoint B: главный экран похож на согласованный макет, список сюжетов стал рабочей очередью.
- Checkpoint C: приоритеты считаются и объясняются.
- Checkpoint D: карточка сюжета открывается с вкладками.
- Checkpoint E: вкладка `Текст` содержит текущий редактор и не ломает его сценарии.
- Checkpoint F: визуальная полировка и smoke-check завершены.

Короткая карта этапов для контроля:

| Этап | Что должно стать видно | Пользовательская приемка |
| --- | --- | --- |
| 1. UI-основа | Единые русские labels, бейджи, приоритеты | В интерфейсе нет новых английских терминов |
| 2. Shell | Левая навигация и профиль снизу | Можно войти, выйти, сменить пароль, открыть разделы |
| 3. Главный экран | Компактная сводка и список сюжетов | Сразу видно, что назначено и что делать первым |
| 4. Приоритет | Колонка “Приоритет” с причиной | Понятно, почему сюжет выше остальных |
| 5. Карточка сюжета | Вкладки `Обзор`, `Текст`, `Правки`, `Материалы`, `Производство`, `История` | Карточка объясняет состояние сюжета без длинной простыни |
| 6. Текст | Текущий редактор внутри вкладки `Текст` | Редактор работает как раньше |
| 7. Полировка | Макеты доведены до рабочего вида | Нет перегруза, текст не обрезается, smoke-check пройден |

## 2. Планируемая структура файлов

### Новые файлы frontend

- `frontend/src/shared/labels.ts`
  Единые русские labels для статусов, ролей, этапов, действий. Убирает разрозненные словари из компонентов.

- `frontend/src/shared/date.ts`
  Единое форматирование дат для списка и карточки.

- `frontend/src/features/projects/projectPriority.ts`
  Расчет приоритета: уровень, причина, вес сортировки. Не содержит React.

- `frontend/src/features/projects/projectPresentation.ts`
  Презентационные helpers для списка сюжетов: причины попадания в очередь, состояния, ответственные, производственные сигналы.

- `frontend/src/components/AppShell.tsx`
  Общий shell: sidebar, navigation, user profile, content area.

- `frontend/src/components/UserProfileMenu.tsx`
  Нижний профиль пользователя в sidebar: имя, роль, смена пароля, выход.

- `frontend/src/components/StatusBadge.tsx`
  Единый badge состояния: обычный, успешно, предупреждение, критично.

- `frontend/src/components/PriorityBadge.tsx`
  Приоритет с причиной.

- `frontend/src/components/ProjectList.tsx`
  Новый список сюжетов вместо текущего табличного `ProjectsTable` на первом экране.

- `frontend/src/components/ProjectListRow.tsx`
  Одна строка списка с inline-раскрытием задач.

- `frontend/src/components/ProjectFiltersBar.tsx`
  Поиск и фильтры списка.

- `frontend/src/components/ProjectSummaryStrip.tsx`
  Компактная сводка главного экрана.

- `frontend/src/pages/ProjectCardPage.tsx`
  Новая оболочка карточки сюжета с вкладками.

- `frontend/src/components/project-card/ProjectCardHeader.tsx`
- `frontend/src/components/project-card/ProjectCardTabs.tsx`
- `frontend/src/components/project-card/ProjectOverviewTab.tsx`

### Существующие файлы для изменения

- `frontend/src/App.tsx`
  Подключить `AppShell`, заменить переход `editor` на карточку сюжета.

- `frontend/src/pages/MainPage.tsx`
  Упростить страницу: данные, создание/архив/restore/admin остаются, визуальная сборка уходит в новые компоненты.

- `frontend/src/pages/EditorPage.tsx`
  Не переписывать editor core. На первом этапе добавить только embedded-режим, чтобы текущий редактор работал внутри карточки.

- `frontend/src/components/ProjectsTable.tsx`
  Не удалять сразу. Сначала заменить использование на `ProjectList`; затем удалить или оставить как fallback после проверки.

- `frontend/src/styles.css`
  Перевести стили на согласованный визуальный язык: sidebar, compact strip, project list, badges, tabs, card layout.

- `frontend/src/shared/types.ts`
  Добавить только frontend presentation-типы, если их нельзя держать локально в `features/projects`.

- `docs/WEB_SMOKE_CHECKLIST_RU.md`
  Добавить smoke-сценарии нового UI.

## 3. Фаза 1 — подготовка UI-основы

### Task 1: Добавить русские labels и date helpers

**Цель для пользователя:** интерфейс начинает использовать единые русские формулировки.

**Files:**

- Create: `frontend/src/shared/labels.ts`
- Create: `frontend/src/shared/date.ts`
- Modify: `frontend/src/components/ProjectsTable.tsx`

- [ ] **Step 1: Создать `frontend/src/shared/labels.ts`**

Содержимое:

```ts
import type {
  EditStatusValue,
  FinalReviewStatusValue,
  ProjectStatusValue,
  TitlesStatusValue,
  VoiceoverStatusValue,
} from "./types";

export const PROJECT_STATUS_LABELS: Record<ProjectStatusValue | string, string> = {
  draft: "Черновик",
  reviewed: "На проверке",
  in_editing: "В работе",
  in_proofreading: "На корректуре",
  ready: "Готово",
  delivered: "Сдано",
  archived: "Архив",
};

export const TRACK_STATUS_LABELS: Record<
  TitlesStatusValue | EditStatusValue | VoiceoverStatusValue | FinalReviewStatusValue | string,
  string
> = {
  not_started: "Не начато",
  in_progress: "В работе",
  review: "На проверке",
  changes_requested: "Нужны правки",
  done: "Готово",
  submitted: "Отправлено наверх",
  approved: "Утверждено",
};

export const USER_ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  editor: "Шеф / редактор",
  author: "Автор",
  proofreader: "Корректор",
  montager: "Монтажер",
  designer: "Дизайнер",
  operator: "Оператор",
};

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status] || status || "-";
}

export function trackStatusLabel(status?: string | null): string {
  return TRACK_STATUS_LABELS[status || "not_started"] || status || "Не начато";
}

export function userRoleLabel(role?: string | null): string {
  return USER_ROLE_LABELS[role || ""] || role || "Роль не указана";
}
```

- [ ] **Step 2: Создать `frontend/src/shared/date.ts`**

Содержимое:

```ts
export function formatDateTime(isoValue?: string | null): string {
  if (!isoValue) {
    return "-";
  }
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return isoValue;
  }
  return parsed.toLocaleString("ru-RU");
}
```

- [ ] **Step 3: Перевести `ProjectsTable.tsx` на helpers**

Заменить локальные `STATUS_LABELS`, `formatDate`, `statusLabel` на imports:

```ts
import { formatDateTime } from "../shared/date";
import { projectStatusLabel } from "../shared/labels";
```

И заменить вызовы:

```tsx
<td>{projectStatusLabel(row.status)}</td>
<td>{formatDateTime(row.created_at)}</td>
{view === "archive" ? formatDateTime(row.archived_at) : formatDateTime(row.status_changed_at)}
```

- [ ] **Step 4: Проверить сборку**

Run:

```bash
cd frontend && npm run build
```

Expected: build passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/labels.ts frontend/src/shared/date.ts frontend/src/components/ProjectsTable.tsx
git commit -m "refactor: centralize frontend labels"
```

### Task 2: Добавить базовые UI primitives

**Цель для пользователя:** состояния и приоритеты начинают выглядеть одинаково во всех будущих экранах.

**Files:**

- Create: `frontend/src/components/StatusBadge.tsx`
- Create: `frontend/src/components/PriorityBadge.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Создать `StatusBadge.tsx`**

```tsx
interface StatusBadgeProps {
  tone?: "neutral" | "ok" | "warn" | "danger";
  children: string;
}

export default function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}
```

- [ ] **Step 2: Создать `PriorityBadge.tsx`**

```tsx
export type ProjectPriorityLevel = "urgent" | "high" | "normal" | "low";

interface PriorityBadgeProps {
  level: ProjectPriorityLevel;
  label: string;
  reason: string;
}

export default function PriorityBadge({ level, label, reason }: PriorityBadgeProps) {
  return (
    <span className={`priority-badge priority-badge-${level}`}>
      <strong>{label}</strong>
      <span>{reason}</span>
    </span>
  );
}
```

- [ ] **Step 3: Добавить стили в `styles.css`**

Добавить блоки:

```css
.status-badge,
.priority-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  border: 1px solid var(--brand-border-soft);
  background: #eef2f6;
  color: var(--brand-muted);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
}

.status-badge {
  padding: 3px 8px;
}

.priority-badge {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border-radius: 8px;
  padding: 6px 8px;
}

.priority-badge span {
  font-size: 12px;
  font-weight: 600;
}

.status-badge-ok,
.priority-badge-normal {
  background: #e7f6ec;
  border-color: #b7e0c2;
  color: #0b6b37;
}

.status-badge-warn,
.priority-badge-high {
  background: #fff3e0;
  border-color: #f3d19b;
  color: #9a6700;
}

.status-badge-danger,
.priority-badge-urgent {
  background: var(--brand-red-050);
  border-color: #f5b9b4;
  color: #a32b22;
}

.priority-badge-low {
  background: #eef2f6;
  border-color: #d8dde6;
  color: #596273;
}
```

- [ ] **Step 4: Проверить сборку**

Run:

```bash
cd frontend && npm run build
```

Expected: build passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/StatusBadge.tsx frontend/src/components/PriorityBadge.tsx frontend/src/styles.css
git commit -m "feat: add shared ui status primitives"
```

## 4. Фаза 2 — presentation logic списка сюжетов

### Task 3: Реализовать расчет приоритета

**Цель для пользователя:** колонка “Приоритет” объясняет порядок внимания, а не дублирует состояние.

**Files:**

- Create: `frontend/src/features/projects/projectPriority.ts`

- [ ] **Step 1: Создать `projectPriority.ts`**

```ts
import type { ProjectListItem, UserPublic } from "../../shared/types";

export type ProjectPriorityLevel = "urgent" | "high" | "normal" | "low";

export interface ProjectPriority {
  level: ProjectPriorityLevel;
  label: string;
  reason: string;
  sortWeight: number;
}

function hasActiveProduction(project: ProjectListItem): boolean {
  return (
    (project.edit_status || "not_started") !== "not_started" ||
    (project.titles_status || "not_started") !== "not_started" ||
    (project.voiceover_status || "not_started") !== "not_started"
  );
}

export function getProjectPriority(project: ProjectListItem, user?: UserPublic | null): ProjectPriority {
  if (project.titles_requires_resync) {
    return {
      level: "urgent",
      label: "Срочно",
      reason: "текст изменился после начала титров",
      sortWeight: 100,
    };
  }

  if (project.edit_requires_resync) {
    return {
      level: "urgent",
      label: "Срочно",
      reason: "текст изменился после начала монтажа",
      sortWeight: 95,
    };
  }

  if (hasActiveProduction(project) && !project.current_text_seq) {
    return {
      level: "urgent",
      label: "Срочно",
      reason: "нет текущего текста при активном производстве",
      sortWeight: 90,
    };
  }

  if ((project.my_open_action_comment_count || 0) > 0) {
    return {
      level: "high",
      label: "Высокий",
      reason: "есть назначенные открытые правки",
      sortWeight: 80,
    };
  }

  if (project.current_text_seq && !project.current_text_is_latest) {
    return {
      level: "high",
      label: "Высокий",
      reason: "рабочий текст новее текущего",
      sortWeight: 70,
    };
  }

  if (project.proofread_text_seq && !project.latest_text_is_proofread) {
    return {
      level: "high",
      label: "Высокий",
      reason: "вычитка устарела",
      sortWeight: 65,
    };
  }

  if (user && project.proofreader_user_id === user.id && project.current_text_seq && !project.proofread_text_is_current) {
    return {
      level: "normal",
      label: "Обычный",
      reason: "текущий текст ждет вычитки",
      sortWeight: 45,
    };
  }

  if ((project.open_action_comment_count || 0) > 0) {
    return {
      level: "normal",
      label: "Обычный",
      reason: "есть открытые правки",
      sortWeight: 40,
    };
  }

  return {
    level: "low",
    label: "Низкий",
    reason: "нет срочного действия",
    sortWeight: 10,
  };
}
```

- [ ] **Step 2: Проверить типизацию**

Run:

```bash
cd frontend && npm run build
```

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/projects/projectPriority.ts
git commit -m "feat: add project priority rules"
```

### Task 4: Реализовать presentation helpers для списка сюжетов

**Цель для пользователя:** строка списка объясняет “почему здесь” и “что сделать”.

**Files:**

- Create: `frontend/src/features/projects/projectPresentation.ts`

- [ ] **Step 1: Создать `projectPresentation.ts`**

```ts
import type { ProjectListItem, UserPublic } from "../../shared/types";

export type BadgeTone = "neutral" | "ok" | "warn" | "danger";

export interface ProjectStateBadge {
  tone: BadgeTone;
  label: string;
}

export interface ProjectTaskHint {
  tone: BadgeTone;
  title: string;
  detail: string;
}

export interface ProjectRowPresentation {
  reasonTitle: string;
  reasonDetail: string;
  nextAction: string;
  stateBadges: ProjectStateBadge[];
  tasks: ProjectTaskHint[];
}

export function getProjectStateBadges(project: ProjectListItem): ProjectStateBadge[] {
  const badges: ProjectStateBadge[] = [];

  if (!project.current_text_seq) {
    badges.push({ tone: "warn", label: "Нет текущего текста" });
  } else if (!project.current_text_is_latest) {
    badges.push({ tone: "warn", label: "Текущий текст устарел" });
  } else {
    badges.push({ tone: "ok", label: "Текущий текст есть" });
  }

  if (project.checked_text_seq && project.checked_text_is_current) {
    badges.push({ tone: "ok", label: "Проверено" });
  }

  if (!project.proofread_text_seq) {
    badges.push({ tone: "neutral", label: "Не вычитано" });
  } else if (!project.latest_text_is_proofread) {
    badges.push({ tone: "danger", label: "Вычитка устарела" });
  } else {
    badges.push({ tone: "ok", label: "Вычитано" });
  }

  if (project.titles_requires_resync) {
    badges.push({ tone: "danger", label: "Титры устарели" });
  }

  if (project.edit_requires_resync) {
    badges.push({ tone: "danger", label: "Монтаж требует проверки" });
  }

  if ((project.open_action_comment_count || 0) > 0) {
    badges.push({ tone: "warn", label: `Открытых правок: ${project.open_action_comment_count || 0}` });
  }

  return badges;
}

export function getProjectTasks(project: ProjectListItem, user: UserPublic): ProjectTaskHint[] {
  const tasks: ProjectTaskHint[] = [];

  if ((project.my_open_action_comment_count || 0) > 0) {
    tasks.push({
      tone: "danger",
      title: "Назначенная правка",
      detail: `Открытых назначенных правок: ${project.my_open_action_comment_count || 0}.`,
    });
  }

  if (project.author_user_id === user.id && project.current_text_seq && !project.current_text_is_latest) {
    tasks.push({
      tone: "warn",
      title: "Назначить новый текущий текст",
      detail: "Рабочий текст новее текущего состояния.",
    });
  }

  if (project.proofreader_user_id === user.id && project.current_text_seq && !project.proofread_text_is_current) {
    tasks.push({
      tone: "warn",
      title: "Вычитать текущий текст",
      detail: "Текущий текст ждет подтверждения корректора.",
    });
  }

  if (project.titles_requires_resync) {
    tasks.push({
      tone: "danger",
      title: "Показать изменения дизайнеру",
      detail: "Текст изменился после начала титров.",
    });
  }

  if (project.edit_requires_resync) {
    tasks.push({
      tone: "danger",
      title: "Проверить передачу в монтаж",
      detail: "Текст изменился после начала монтажа.",
    });
  }

  return tasks;
}

export function getProjectRowPresentation(project: ProjectListItem, user: UserPublic): ProjectRowPresentation {
  const tasks = getProjectTasks(project, user);
  const firstTask = tasks[0];

  if (firstTask) {
    return {
      reasonTitle: tasks.length > 1 ? `${tasks.length} задачи в сюжете` : firstTask.title,
      reasonDetail: firstTask.detail,
      nextAction: firstTask.title,
      stateBadges: getProjectStateBadges(project),
      tasks,
    };
  }

  return {
    reasonTitle: "Сюжет в работе",
    reasonDetail: "Нет срочного персонального действия.",
    nextAction: "Открыть карточку",
    stateBadges: getProjectStateBadges(project),
    tasks,
  };
}
```

- [ ] **Step 2: Проверить сборку**

Run:

```bash
cd frontend && npm run build
```

Expected: build passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/projects/projectPresentation.ts
git commit -m "feat: add project list presentation helpers"
```

## 5. Фаза 3 — общий shell

### Task 5: Реализовать sidebar и профиль пользователя

**Цель для пользователя:** приложение получает современную постоянную навигацию и профиль внизу.

**Files:**

- Create: `frontend/src/components/UserProfileMenu.tsx`
- Create: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Создать `UserProfileMenu.tsx`**

```tsx
import { userRoleLabel } from "../shared/labels";
import type { UserPublic } from "../shared/types";

interface UserProfileMenuProps {
  user: UserPublic;
  onLogout: () => void;
  onOpenChangePassword: () => void;
}

export default function UserProfileMenu({ user, onLogout, onOpenChangePassword }: UserProfileMenuProps) {
  const displayName = user.full_name || user.username;

  return (
    <div className="user-profile-menu">
      <div>
        <strong>{displayName}</strong>
        <span>{userRoleLabel(user.role)}</span>
      </div>
      {user.must_change_password ? (
        <div className="user-profile-alert">Нужно сменить временный пароль</div>
      ) : null}
      <div className="user-profile-actions">
        <button className="text-button" type="button" onClick={onOpenChangePassword}>
          Сменить пароль
        </button>
        <button className="text-button" type="button" onClick={onLogout}>
          Выйти
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Создать `AppShell.tsx`**

```tsx
import type { ReactNode } from "react";

import { BRAND } from "../shared/brand";
import type { UserPublic } from "../shared/types";
import UserProfileMenu from "./UserProfileMenu";

export type AppSection = "my_work" | "management" | "production" | "all_projects" | "archive" | "admin";

interface AppShellProps {
  user: UserPublic;
  activeSection: AppSection;
  children: ReactNode;
  onNavigate: (section: AppSection) => void;
  onLogout: () => void;
  onOpenChangePassword: () => void;
}

const NAV_ITEMS: Array<{ key: AppSection; label: string }> = [
  { key: "my_work", label: "Моя работа" },
  { key: "management", label: "Управление" },
  { key: "production", label: "Производство" },
  { key: "all_projects", label: "Все сюжеты" },
  { key: "archive", label: "Архив" },
  { key: "admin", label: "Администрирование" },
];

export default function AppShell({
  user,
  activeSection,
  children,
  onNavigate,
  onLogout,
  onOpenChangePassword,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-brand">
          <img src={BRAND.logoPath} alt={`${BRAND.companyName} logo`} />
          <div>
            <strong>{BRAND.appName}</strong>
            <span>карточка сюжета и производство</span>
          </div>
        </div>
        <nav className="app-sidebar-nav" aria-label="Основная навигация">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === activeSection ? "app-sidebar-nav-item active" : "app-sidebar-nav-item"}
              onClick={() => onNavigate(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <UserProfileMenu
          user={user}
          onLogout={onLogout}
          onOpenChangePassword={onOpenChangePassword}
        />
      </aside>
      <section className="app-content">{children}</section>
    </div>
  );
}
```

- [ ] **Step 3: Обернуть main view в `AppShell`**

В `App.tsx` оставить login/change-password без shell. Для `MainPage` передать `onOpenChangePassword`, `onLogout`, а shell подключить внутри `MainPage` в Task 7. На этом шаге только импорт не нужен; если shell еще не используется, build все равно должен проходить.

- [ ] **Step 4: Добавить стили shell**

В `styles.css` добавить:

```css
.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  background: var(--brand-bg);
}

.app-sidebar {
  background: var(--brand-surface);
  border-right: 1px solid var(--brand-border-soft);
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.app-sidebar-brand {
  display: grid;
  gap: 8px;
  padding: 4px 8px 14px;
  border-bottom: 1px solid var(--brand-border-soft);
}

.app-sidebar-brand img {
  max-width: 180px;
  height: auto;
}

.app-sidebar-brand strong {
  color: var(--brand-blue-700);
  font-family: var(--brand-font-heading);
  font-size: 20px;
}

.app-sidebar-brand span {
  display: block;
  margin-top: 4px;
  color: var(--brand-muted);
  font-size: 13px;
}

.app-sidebar-nav {
  display: grid;
  gap: 4px;
}

.app-sidebar-nav-item {
  min-height: 38px;
  justify-content: flex-start;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--brand-muted);
  font-weight: 700;
  text-align: left;
}

.app-sidebar-nav-item.active {
  background: var(--brand-blue-050);
  color: var(--brand-blue-700);
  box-shadow: inset 3px 0 0 var(--brand-blue-700);
}

.app-content {
  min-width: 0;
  padding: 18px 22px 32px;
}

.user-profile-menu {
  margin-top: auto;
  border-top: 1px solid var(--brand-border-soft);
  padding: 14px 8px 0;
  display: grid;
  gap: 8px;
  color: var(--brand-muted);
  font-size: 13px;
}

.user-profile-menu strong,
.user-profile-menu span {
  display: block;
}

.user-profile-menu strong {
  color: var(--brand-text);
}

.user-profile-alert {
  border: 1px solid #f3d19b;
  border-radius: 8px;
  background: #fff3e0;
  color: #9a6700;
  padding: 8px;
  font-weight: 700;
}

.user-profile-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.text-button {
  min-height: auto;
  border: 0;
  background: transparent;
  color: var(--brand-blue-700);
  padding: 0;
  font-weight: 700;
}
```

- [ ] **Step 5: Проверить сборку**

Run:

```bash
cd frontend && npm run build
```

Expected: build passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AppShell.tsx frontend/src/components/UserProfileMenu.tsx frontend/src/styles.css
git commit -m "feat: add application shell"
```

## 6. Фаза 4 — новый главный экран и список сюжетов

### Task 6: Реализовать компактную сводку и фильтры

**Цель для пользователя:** главный экран получает компактный верх, как в макете.

**Files:**

- Create: `frontend/src/components/ProjectSummaryStrip.tsx`
- Create: `frontend/src/components/ProjectFiltersBar.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Создать `ProjectSummaryStrip.tsx`**

```tsx
import type { ProjectListItem, UserPublic } from "../shared/types";
import { getProjectPriority } from "../features/projects/projectPriority";

interface ProjectSummaryStripProps {
  projects: ProjectListItem[];
  user: UserPublic;
}

export default function ProjectSummaryStrip({ projects, user }: ProjectSummaryStripProps) {
  const assignedToMe = projects.filter((project) => {
    return (
      project.author_user_id === user.id ||
      project.proofreader_user_id === user.id ||
      project.edit_assignee_user_id === user.id ||
      project.titles_assignee_user_id === user.id ||
      (project.my_open_action_comment_count || 0) > 0
    );
  }).length;
  const priorities = projects.map((project) => getProjectPriority(project, user));
  const urgentCount = priorities.filter((priority) => priority.level === "urgent").length;
  const highCount = priorities.filter((priority) => priority.level === "high").length;
  const openActions = projects.reduce((sum, project) => sum + (project.open_action_comment_count || 0), 0);

  return (
    <div className="project-summary-strip">
      <span><strong>{assignedToMe}</strong> назначено мне</span>
      <span><strong>{urgentCount}</strong> срочно</span>
      <span><strong>{highCount}</strong> высокий приоритет</span>
      <span><strong>{openActions}</strong> открытых правок</span>
    </div>
  );
}
```

- [ ] **Step 2: Создать `ProjectFiltersBar.tsx`**

```tsx
interface ProjectFiltersBarProps {
  search: string;
  onSearchChange: (value: string) => void;
}

export default function ProjectFiltersBar({ search, onSearchChange }: ProjectFiltersBarProps) {
  return (
    <div className="project-filters-bar">
      <label>
        Поиск
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Название, рубрика, участник"
        />
      </label>
      <button type="button" className="secondary">Состояние</button>
      <button type="button" className="secondary">Приоритет</button>
      <button type="button" className="secondary">Участник</button>
    </div>
  );
}
```

- [ ] **Step 3: Добавить стили**

```css
.project-summary-strip,
.project-filters-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.project-summary-strip {
  margin: 10px 0;
}

.project-summary-strip span {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--brand-border-soft);
  border-radius: 8px;
  background: var(--brand-surface);
  padding: 7px 10px;
  color: var(--brand-muted);
  font-size: 13px;
  font-weight: 700;
}

.project-summary-strip strong {
  color: var(--brand-blue-700);
  font-size: 16px;
}

.project-filters-bar {
  padding: 12px;
  border: 1px solid var(--brand-border-soft);
  border-radius: 10px;
  background: var(--brand-surface);
}

.project-filters-bar label {
  margin: 0;
  min-width: 260px;
}
```

- [ ] **Step 4: Проверить сборку и commit**

```bash
cd frontend && npm run build
git add frontend/src/components/ProjectSummaryStrip.tsx frontend/src/components/ProjectFiltersBar.tsx frontend/src/styles.css
git commit -m "feat: add project dashboard controls"
```

### Task 7: Реализовать новый `ProjectList`

**Цель для пользователя:** список сюжетов становится рабочей очередью с приоритетом и раскрытием строки.

**Files:**

- Create: `frontend/src/components/ProjectList.tsx`
- Create: `frontend/src/components/ProjectListRow.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Создать `ProjectListRow.tsx`**

```tsx
import { useState } from "react";
import { getProjectPriority } from "../features/projects/projectPriority";
import { getProjectRowPresentation } from "../features/projects/projectPresentation";
import type { ProjectListItem, UserPublic } from "../shared/types";
import PriorityBadge from "./PriorityBadge";
import StatusBadge from "./StatusBadge";

interface ProjectListRowProps {
  project: ProjectListItem;
  user: UserPublic;
  onOpenProject: (projectId: number) => void;
}

export default function ProjectListRow({ project, user, onOpenProject }: ProjectListRowProps) {
  const [expanded, setExpanded] = useState(false);
  const presentation = getProjectRowPresentation(project, user);
  const priority = getProjectPriority(project, user);

  return (
    <>
      <tr>
        <td>
          <strong className="project-list-title">{project.title}</strong>
          <span className="project-list-meta">{project.rubric || "Без рубрики"}</span>
        </td>
        <td>
          <strong>{presentation.reasonTitle}</strong>
          <span className="project-list-meta">{presentation.reasonDetail}</span>
        </td>
        <td>{presentation.nextAction}</td>
        <td>
          <div className="project-list-badges">
            {presentation.stateBadges.map((badge) => (
              <StatusBadge key={badge.label} tone={badge.tone === "neutral" ? "neutral" : badge.tone}>
                {badge.label}
              </StatusBadge>
            ))}
          </div>
        </td>
        <td>
          <PriorityBadge level={priority.level} label={priority.label} reason={priority.reason} />
        </td>
        <td>
          <div className="project-list-actions">
            <button type="button" className="text-button" onClick={() => onOpenProject(project.id)}>
              Открыть
            </button>
            {presentation.tasks.length > 0 ? (
              <button type="button" className="text-button" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "Свернуть" : "Развернуть"}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr className="project-list-expanded-row">
          <td colSpan={6}>
            <div className="project-list-task-grid">
              {presentation.tasks.map((task) => (
                <div key={`${task.title}-${task.detail}`} className={`project-list-task project-list-task-${task.tone}`}>
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Создать `ProjectList.tsx`**

```tsx
import { getProjectPriority } from "../features/projects/projectPriority";
import type { ProjectListItem, UserPublic } from "../shared/types";
import ProjectListRow from "./ProjectListRow";

interface ProjectListProps {
  projects: ProjectListItem[];
  user: UserPublic;
  onOpenProject: (projectId: number) => void;
}

export default function ProjectList({ projects, user, onOpenProject }: ProjectListProps) {
  const sortedProjects = [...projects].sort((left, right) => {
    return getProjectPriority(right, user).sortWeight - getProjectPriority(left, user).sortWeight;
  });

  return (
    <div className="project-list-panel">
      <table className="project-list-table">
        <thead>
          <tr>
            <th>Сюжет</th>
            <th>Почему здесь</th>
            <th>Что сделать</th>
            <th>Состояние</th>
            <th>Приоритет</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          {sortedProjects.map((project) => (
            <ProjectListRow
              key={project.id}
              project={project}
              user={user}
              onOpenProject={onOpenProject}
            />
          ))}
          {sortedProjects.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted center">
                Сюжеты не найдены
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Добавить стили списка**

Добавить в `styles.css`:

```css
.project-list-panel {
  margin-top: 12px;
  border: 1px solid var(--brand-border-soft);
  border-radius: 10px;
  background: var(--brand-surface);
  overflow-x: auto;
}

.project-list-table {
  width: 100%;
  min-width: 1080px;
  border-collapse: collapse;
}

.project-list-table th,
.project-list-table td {
  padding: 10px;
  border-bottom: 1px solid var(--brand-border-soft);
  vertical-align: top;
}

.project-list-table th {
  background: #f5f8fc;
  color: var(--brand-muted);
  font-size: 12px;
}

.project-list-title,
.project-list-meta {
  display: block;
}

.project-list-title {
  color: var(--brand-blue-700);
}

.project-list-meta {
  margin-top: 4px;
  color: var(--brand-muted);
  font-size: 12px;
}

.project-list-badges,
.project-list-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.project-list-expanded-row td {
  background: #fbfdff;
}

.project-list-task-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.project-list-task {
  border-left: 3px solid var(--brand-blue-600);
  border-radius: 8px;
  background: var(--brand-surface);
  padding: 9px;
}

.project-list-task strong,
.project-list-task span {
  display: block;
}

.project-list-task span {
  margin-top: 4px;
  color: var(--brand-muted);
  font-size: 12px;
}

.project-list-task-warn {
  border-color: #9a6700;
}

.project-list-task-danger {
  border-color: var(--brand-red-500);
}
```

- [ ] **Step 4: Проверить сборку и commit**

```bash
cd frontend && npm run build
git add frontend/src/components/ProjectList.tsx frontend/src/components/ProjectListRow.tsx frontend/src/styles.css
git commit -m "feat: add project work list"
```

### Task 8: Подключить новый главный экран

**Цель для пользователя:** после входа виден новый главный экран с sidebar, сводкой и списком сюжетов.

**Files:**

- Modify: `frontend/src/pages/MainPage.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: В `MainPage.tsx` добавить state активного раздела**

Добавить:

```ts
import AppShell, { type AppSection } from "../components/AppShell";
import ProjectFiltersBar from "../components/ProjectFiltersBar";
import ProjectList from "../components/ProjectList";
import ProjectSummaryStrip from "../components/ProjectSummaryStrip";
```

Внутри компонента:

```ts
const [activeSection, setActiveSection] = useState<AppSection>("my_work");
```

- [ ] **Step 2: Обернуть содержимое в `AppShell`**

Главный return `MainPage` должен иметь верхний уровень:

```tsx
return (
  <AppShell
    user={user}
    activeSection={activeSection}
    onNavigate={setActiveSection}
    onLogout={onLogout}
    onOpenChangePassword={onOpenChangePassword}
  >
    <section className="workspace-header">
      <div>
        <p className="muted small">сегодня · рабочая очередь</p>
        <h2>{activeSection === "management" ? "Управление" : activeSection === "production" ? "Производство" : "Моя работа"}</h2>
      </div>
      <button type="button" onClick={handleCreateEmptyProject}>
        Создать сюжет
      </button>
    </section>
    <ProjectSummaryStrip projects={projects} user={user} />
    <p className="attention-line">
      Первым делом: сюжеты, где текст изменился после начала титров или монтажа.
    </p>
    <ProjectFiltersBar search={search} onSearchChange={setSearch} />
    <ProjectList projects={projects} user={user} onOpenProject={onOpenEditor} />
  </AppShell>
);
```

При интеграции сохранить существующие админ-блоки и действия создания/клонирования/архивации. Если они мешают первому экрану, временно оставить их ниже списка в секции “Служебные действия”.

- [ ] **Step 3: Убедиться, что старые actions не потеряны**

Проверить в UI, что доступны:

- создать пустой сюжет;
- клонировать последний;
- клонировать выбранный;
- архивировать;
- восстановить;
- управление пользователями для admin.

- [ ] **Step 4: Проверить сборку**

```bash
cd frontend && npm run build
```

Expected: build passes.

- [ ] **Step 5: Manual checkpoint A/B**

Запустить dev server:

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

Проверить:

- login screen открывается;
- после входа виден sidebar;
- профиль пользователя внизу;
- список сюжетов виден без скролла глубоко вниз;
- строка с несколькими задачами раскрывается inline;
- кнопка “Открыть” ведет к прежнему редактору/карточке.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/MainPage.tsx frontend/src/App.tsx
git commit -m "feat: redesign main project dashboard"
```

## 7. Фаза 5 — карточка сюжета с вкладками

### Task 9: Создать оболочку карточки сюжета

**Цель для пользователя:** открытие сюжета ведет в карточку с вкладками, а не просто в изолированный редактор.

**Files:**

- Create: `frontend/src/pages/ProjectCardPage.tsx`
- Create: `frontend/src/components/project-card/ProjectCardHeader.tsx`
- Create: `frontend/src/components/project-card/ProjectCardTabs.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Создать `ProjectCardTabs.tsx`**

```tsx
export type ProjectCardTab = "overview" | "text" | "comments" | "materials" | "production" | "history";

interface ProjectCardTabsProps {
  activeTab: ProjectCardTab;
  onChange: (tab: ProjectCardTab) => void;
}

const TABS: Array<{ key: ProjectCardTab; label: string }> = [
  { key: "overview", label: "Обзор" },
  { key: "text", label: "Текст" },
  { key: "comments", label: "Правки" },
  { key: "materials", label: "Материалы" },
  { key: "production", label: "Производство" },
  { key: "history", label: "История" },
];

export default function ProjectCardTabs({ activeTab, onChange }: ProjectCardTabsProps) {
  return (
    <nav className="project-card-tabs" aria-label="Разделы карточки">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={tab.key === activeTab ? "project-card-tab active" : "project-card-tab"}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Создать `ProjectCardHeader.tsx`**

```tsx
import { getProjectStateBadges } from "../../features/projects/projectPresentation";
import { formatDateTime } from "../../shared/date";
import { projectStatusLabel } from "../../shared/labels";
import type { ProjectListItem } from "../../shared/types";
import StatusBadge from "../StatusBadge";

interface ProjectCardHeaderProps {
  project: ProjectListItem;
  onBack: () => void;
}

export default function ProjectCardHeader({ project, onBack }: ProjectCardHeaderProps) {
  return (
    <>
      <button type="button" className="text-button project-card-back" onClick={onBack}>
        ← К списку сюжетов
      </button>
      <section className="project-card-header">
        <div className="project-card-heading">
          <div>
            <p className="muted small">карточка сюжета · {project.rubric || "без рубрики"}</p>
            <h2>{project.title}</h2>
            <p className="muted small">
              Статус: {projectStatusLabel(project.status)} · обновлено {formatDateTime(project.status_changed_at || project.created_at)}
            </p>
          </div>
        </div>
        <div className="project-card-status-strip">
          {getProjectStateBadges(project).slice(0, 5).map((badge) => (
            <StatusBadge key={badge.label} tone={badge.tone === "neutral" ? "neutral" : badge.tone}>
              {badge.label}
            </StatusBadge>
          ))}
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 3: Создать `ProjectCardPage.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { fetchProjects } from "../shared/api";
import type { ProjectListItem, UserPublic } from "../shared/types";
import ProjectCardHeader from "../components/project-card/ProjectCardHeader";
import ProjectCardTabs, { type ProjectCardTab } from "../components/project-card/ProjectCardTabs";

interface ProjectCardPageProps {
  token: string;
  projectId: number;
  user: UserPublic;
  onBackToMain: () => void;
  renderTextEditor: () => ReactNode;
}

export default function ProjectCardPage({ token, projectId, user: _user, onBackToMain, renderTextEditor }: ProjectCardPageProps) {
  const [project, setProject] = useState<ProjectListItem | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectCardTab>("overview");

  useEffect(() => {
    void (async () => {
      const response = await fetchProjects("main", { search: "", status: [], rubric: "", participant: "", created_from: "", created_to: "", archived_by: "", archived_from: "", archived_to: "" }, token);
      setProject(response.items.find((item) => item.id === projectId) || null);
    })();
  }, [projectId, token]);

  if (!project) {
    return <p className="muted">Загрузка карточки сюжета...</p>;
  }

  return (
    <section className="project-card-page">
      <ProjectCardHeader project={project} onBack={onBackToMain} />
      <ProjectCardTabs activeTab={activeTab} onChange={setActiveTab} />
      {activeTab === "overview" ? <div className="card">Обзор будет добавлен следующим шагом.</div> : null}
      {activeTab === "text" ? renderTextEditor() : null}
      {activeTab !== "overview" && activeTab !== "text" ? (
        <div className="card">Раздел будет перенесен из текущего редактора отдельным шагом.</div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 4: Подключить карточку в `App.tsx`**

Первый безопасный вариант: `ProjectCardPage` отображает вкладки, а во вкладке `Текст` рендерит существующий `EditorPage`.

```tsx
<ProjectCardPage
  user={user}
  token={token}
  projectId={activeProjectId}
  onBackToMain={handleBackToMain}
  renderTextEditor={() => (
    <EditorPage
      user={user}
      token={token}
      projectId={activeProjectId}
      onBackToMain={handleBackToMain}
    />
  )}
/>
```

Если `EditorPage` уже содержит собственный back/header, на первом шаге это допустимо. Убрать дублирование только в Task 11.

- [ ] **Step 5: Проверить сборку и commit**

```bash
cd frontend && npm run build
git add frontend/src/pages/ProjectCardPage.tsx frontend/src/components/project-card/ProjectCardHeader.tsx frontend/src/components/project-card/ProjectCardTabs.tsx frontend/src/App.tsx
git commit -m "feat: add project card shell"
```

### Task 10: Реализовать вкладку “Обзор”

**Цель для пользователя:** карточка за 10 секунд отвечает, что происходит с сюжетом.

**Files:**

- Create: `frontend/src/components/project-card/ProjectOverviewTab.tsx`
- Modify: `frontend/src/pages/ProjectCardPage.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Создать `ProjectOverviewTab.tsx`**

```tsx
import { getProjectPriority } from "../../features/projects/projectPriority";
import type { ProjectListItem, UserPublic } from "../../shared/types";

interface ProjectOverviewTabProps {
  project: ProjectListItem;
  user: UserPublic;
  onOpenText: () => void;
}

export default function ProjectOverviewTab({ project, user, onOpenText }: ProjectOverviewTabProps) {
  const priority = getProjectPriority(project, user);

  return (
    <section className="project-overview-grid">
      <article className="card project-next-action">
        <h3>Следующее действие</h3>
        <p>
          {priority.level === "urgent" || priority.level === "high"
            ? priority.reason
            : "Открыть карточку и продолжить штатный этап."}
        </p>
        <button type="button" onClick={onOpenText}>Открыть текст</button>
      </article>

      <article className="card">
        <h3>Этапы производства</h3>
        <div className="project-stage-grid">
          <span>Текст: {project.current_text_seq ? "текущий текст есть" : "нет текущего текста"}</span>
          <span>Вычитка: {project.latest_text_is_proofread ? "актуальна" : "требует проверки"}</span>
          <span>Озвучка: {project.voiceover_status || "не начато"}</span>
          <span>Монтаж: {project.edit_status || "не начато"}</span>
          <span>Титры: {project.titles_requires_resync ? "требуют проверки" : project.titles_status || "не начато"}</span>
        </div>
      </article>

      <article className="card">
        <h3>Основные данные</h3>
        <p>Рубрика: {project.rubric || "не указана"}</p>
        <p>Плановый хронометраж: {project.planned_duration || "не указан"}</p>
        <p>Приоритет: {priority.label} · {priority.reason}</p>
      </article>
    </section>
  );
}
```

- [ ] **Step 2: Подключить tab**

В `ProjectCardPage.tsx`:

```tsx
import ProjectOverviewTab from "../components/project-card/ProjectOverviewTab";
```

Заменить overview placeholder:

```tsx
{activeTab === "overview" ? (
  <ProjectOverviewTab project={project} user={_user} onOpenText={() => setActiveTab("text")} />
) : null}
```

- [ ] **Step 3: Проверить visual checkpoint**

В браузере:

- карточка открывается;
- вкладка `Обзор` активна;
- есть блок `Следующее действие`;
- есть этапы производства;
- кнопка `Открыть текст` переключает на вкладку `Текст`.

- [ ] **Step 4: Build + commit**

```bash
cd frontend && npm run build
git add frontend/src/components/project-card/ProjectOverviewTab.tsx frontend/src/pages/ProjectCardPage.tsx frontend/src/styles.css
git commit -m "feat: add project overview tab"
```

### Task 11: Аккуратно встроить существующий редактор во вкладку “Текст”

**Цель для пользователя:** редактор остается рабочим, но теперь находится внутри карточки сюжета.

**Files:**

- Modify: `frontend/src/pages/EditorPage.tsx`
- Modify: `frontend/src/pages/ProjectCardPage.tsx`

- [ ] **Step 1: Добавить режим embedded в `EditorPage`**

В `EditorPageProps` добавить:

```ts
embedded?: boolean;
```

В местах, где сейчас показывается собственная кнопка “назад” или крупный заголовок редактора, скрыть их при `embedded`.

Пример:

```tsx
{!embedded ? (
  <button type="button" className="secondary" onClick={onBackToMain}>
    Назад к списку
  </button>
) : null}
```

- [ ] **Step 2: Передать `embedded` из карточки**

В `App.tsx`:

```tsx
<EditorPage
  user={user}
  token={token}
  projectId={activeProjectId}
  onBackToMain={handleBackToMain}
  embedded
/>
```

- [ ] **Step 3: Не менять editor-core**

Запрещено в этой задаче менять:

- `frontend/src/features/editor-core/EditorField.tsx`;
- serializers;
- extensions;
- структуру строк редактора;
- export payload.

- [ ] **Step 4: Smoke-check редактора**

Проверить вручную:

- открыть сюжет;
- перейти на вкладку `Текст`;
- изменить текст в строке;
- дождаться автосохранения;
- назначить текущий текст;
- отметить проверку;
- отметить вычитку;
- открыть `Что изменилось`;
- экспорт не пропал.

- [ ] **Step 5: Build + commit**

```bash
cd frontend && npm run build
git add frontend/src/pages/EditorPage.tsx frontend/src/pages/ProjectCardPage.tsx frontend/src/App.tsx
git commit -m "feat: embed editor in project card"
```

## 8. Фаза 6 — разделы карточки без переписывания редактора

### Task 12: Перенести материалы, правки, производство и историю во вкладки

**Цель для пользователя:** карточка становится единым местом сюжета, а не одной длинной страницей редактора.

**Files:**

- Modify: `frontend/src/pages/EditorPage.tsx`
- Create: `frontend/src/components/project-card/ProjectCommentsTab.tsx`
- Create: `frontend/src/components/project-card/ProjectMaterialsTab.tsx`
- Create: `frontend/src/components/project-card/ProjectProductionTab.tsx`
- Create: `frontend/src/components/project-card/ProjectHistoryTab.tsx`
- Modify: `frontend/src/pages/ProjectCardPage.tsx`

- [ ] **Step 1: Найти блоки в `EditorPage.tsx`**

Выделить текущие секции:

- комментарии / action comments;
- material links / files;
- track statuses: montage, titles, voiceover, final review;
- history.

- [ ] **Step 2: Переносить по одной вкладке**

Порядок:

1. `Материалы`;
2. `Правки`;
3. `Производство`;
4. `История`.

После каждой вкладки запускать:

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Не менять API calls**

На этом этапе переносить существующую логику и props, не менять контракты backend.

- [ ] **Step 4: Checkpoint**

В браузере проверить:

- материалы добавляются/изменяются/удаляются;
- комментарии добавляются, назначаются, закрываются;
- статусы монтажа/титров/озвучки меняются;
- история загружается.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EditorPage.tsx frontend/src/pages/ProjectCardPage.tsx frontend/src/components/project-card
git commit -m "refactor: split project card tabs"
```

## 9. Фаза 7 — визуальная полировка и документация

### Task 13: Финальная CSS-полировка

**Цель для пользователя:** интерфейс соответствует макетам по плотности и читаемости.

**Files:**

- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Проверить sidebar**

Критерии:

- профиль внизу;
- навигация не прыгает;
- активный раздел ясно виден;
- текст не сплющен и не обрезается.

- [ ] **Step 2: Проверить список сюжетов**

Критерии:

- таблица читается на desktop;
- приоритет не выглядит как дублирование состояния;
- раскрытая строка не ломает высоту соседних строк;
- бейджи не распирают строку.

- [ ] **Step 3: Проверить карточку**

Критерии:

- верх карточки не перегружен;
- вкладки читаются;
- вкладка `Текст` не зажимает редактор;
- `Обзор` не дублирует все сигналы из верхней полосы.

- [ ] **Step 4: Build + commit**

```bash
cd frontend && npm run build
git add frontend/src/styles.css
git commit -m "style: polish redesigned workflow UI"
```

### Task 14: Обновить smoke-check документацию

**Цель для пользователя:** после редизайна понятно, как проверять, что ничего не сломалось.

**Files:**

- Modify: `docs/WEB_SMOKE_CHECKLIST_RU.md`
- Modify: `docs/STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md`

- [ ] **Step 1: Добавить smoke-сценарии**

Добавить в `docs/WEB_SMOKE_CHECKLIST_RU.md` раздел:

```md
## UI redesign smoke

- Войти пользователем с ролью editor.
- Проверить, что sidebar виден, профиль пользователя находится внизу.
- Открыть `Моя работа`, `Управление`, `Производство`, `Все сюжеты`.
- Проверить, что список сюжетов сортируется по приоритету.
- Раскрыть строку с несколькими задачами.
- Открыть карточку сюжета.
- Проверить вкладку `Обзор`.
- Открыть вкладку `Текст`.
- Изменить рабочий текст и дождаться автосохранения.
- Назначить текущий текст.
- Отметить проверку и вычитку.
- Проверить, что `Что изменилось` открывается.
- Проверить, что экспорт доступен.
```

- [ ] **Step 2: Обновить snapshot**

В `docs/STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md` добавить ссылку на реализацию редизайна и текущий статус.

- [ ] **Step 3: Commit**

```bash
git add docs/WEB_SMOKE_CHECKLIST_RU.md docs/STATE_SNAPSHOT_AND_NEXT_STEPS_RU.md
git commit -m "docs: add ui redesign smoke checklist"
```

## 10. Финальная проверка ветки

- [ ] **Step 1: Full frontend build**

```bash
cd frontend && npm run build
```

Expected: build passes.

- [ ] **Step 2: Manual smoke**

Run:

```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

Проверить чеклист из `docs/WEB_SMOKE_CHECKLIST_RU.md`.

- [ ] **Step 3: Git hygiene**

```bash
git status --short
```

Expected: clean working tree.

- [ ] **Step 4: Не пушить без отдельного решения**

После выполнения плана подготовить summary:

- что изменено;
- как проверить;
- какие риски остались;
- какие сценарии редактора проверены вручную.

## 11. Риски и guardrails

Риски:

- `MainPage.tsx` и `EditorPage.tsx` уже крупные; перенос блоков может быть конфликтным.
- У текущего проекта нет отдельного test runner для frontend unit tests; основной automated gate пока `npm run build`.
- Приоритеты сначала считаются на frontend по доступным полям. Если позже понадобится общий backend-сортинг, это отдельный API/RFC шаг.
- Вкладка `Текст` может временно иметь дублированные заголовки, пока `EditorPage` не получит `embedded` режим.

Guardrails:

- не менять schema DB;
- не менять export contracts;
- не менять editor-core без отдельного плана;
- после каждого заметного шага запускать `npm run build`;
- после Tasks 8, 11, 12 делать ручной smoke в браузере;
- все пользовательские labels писать по-русски.

## 12. Self-review

Покрытие спеки:

- role-aware главный экран: Tasks 5, 8;
- профиль пользователя: Task 5;
- список сюжетов: Tasks 3, 4, 6, 7, 8;
- приоритет: Task 3;
- карточка сюжета: Tasks 9, 10, 11, 12;
- редактор не ломаем: Task 11 и guardrails;
- русский UX-словарь: Task 1 и guardrails;
- smoke-check: Task 14 и финальная проверка.

Ограничение: план намеренно не включает backend/API изменения и не добавляет новый test runner. Это соответствует первому этапу редизайна из спеки.
