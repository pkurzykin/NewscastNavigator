import { useCallback, useEffect, useState } from "react";

import AppShell, { type AppSection } from "../components/AppShell";
import ProjectFiltersBar, {
  type ProjectQueueFilterOption,
} from "../components/ProjectFiltersBar";
import ProjectList from "../components/ProjectList";
import ProjectSummaryStrip from "../components/ProjectSummaryStrip";
import ProjectsTable from "../components/ProjectsTable";
import {
  archiveProject,
  cloneLastProject,
  cloneSelectedProject,
  createUser,
  createEmptyProject,
  fetchUsers,
  fetchProjects,
  resetUserTemporaryPassword,
  restoreProject,
  updateUser
} from "../shared/api";
import type {
  ProjectFilters,
  ProjectListItem,
  ProjectsView,
  UserListItem,
  UserPublic,
} from "../shared/types";

const PROJECT_STATUS_OPTIONS = [
  { value: "draft", label: "Черновик" },
  { value: "reviewed", label: "На проверке" },
  { value: "in_editing", label: "В работе" },
  { value: "in_proofreading", label: "На корректуре" },
  { value: "ready", label: "Готово" },
  { value: "delivered", label: "Сдано" },
  { value: "archived", label: "Архив" }
];

const USER_ROLE_OPTIONS = [
  { value: "admin", label: "Администратор" },
  { value: "editor", label: "Шеф / редактор" },
  { value: "author", label: "Автор" },
  { value: "proofreader", label: "Корректор" },
  { value: "montager", label: "Монтажер" },
  { value: "designer", label: "Дизайнер" },
];

interface MainPageProps {
  user: UserPublic;
  token: string;
  onLogout: () => void;
  onOpenEditor: (projectId: number) => void;
  onOpenChangePassword: () => void;
}

function buildFilters(params: {
  search: string;
  statusFilter: string[];
  rubricFilter: string;
  participantFilter: string;
  createdFrom: string;
  createdTo: string;
  archivedByFilter: string;
  archivedFrom: string;
  archivedTo: string;
}): ProjectFilters {
  return {
    search: params.search,
    status: params.statusFilter,
    rubric: params.rubricFilter,
    participant: params.participantFilter,
    created_from: params.createdFrom,
    created_to: params.createdTo,
    archived_by: params.archivedByFilter,
    archived_from: params.archivedFrom,
    archived_to: params.archivedTo
  };
}

interface MyWorkItem {
  project: ProjectListItem;
  tone: "warn" | "fresh" | "muted";
  title: string;
  detail: string;
}

type QueueFilterKey =
  | "all"
  | "my_work"
  | "my_actions"
  | "open_actions"
  | "text"
  | "edit"
  | "titles"
  | "voiceover";

interface QueueFilterOption {
  key: QueueFilterKey;
  title: string;
  detail: string;
  tone: "warn" | "fresh" | "muted";
  count: number;
}

function dashboardTitle(section: AppSection): string {
  if (section === "management") {
    return "Управление";
  }
  if (section === "production") {
    return "Производство";
  }
  if (section === "all_projects") {
    return "Все сюжеты";
  }
  if (section === "archive") {
    return "Архив";
  }
  if (section === "admin") {
    return "Администрирование";
  }
  return "Моя работа";
}

interface MyWorkState {
  items: MyWorkItem[];
  byProjectId: Record<number, MyWorkItem[]>;
}

type ActionQueueStage = "open" | "in_progress" | "recently_resolved";

interface MyActionQueueItem {
  project: ProjectListItem;
  stage: ActionQueueStage;
  tone: "warn" | "fresh" | "muted";
  title: string;
  detail: string;
  count: number;
  targetBadges: string[];
}

function actionTargetBadges(project: ProjectListItem): string[] {
  const badges: string[] = [];
  if ((project.my_open_text_action_comment_count || 0) > 0) {
    badges.push("Текст");
  }
  if ((project.my_open_edit_action_comment_count || 0) > 0) {
    badges.push("Монтаж");
  }
  if ((project.my_open_titles_action_comment_count || 0) > 0) {
    badges.push("Титры");
  }
  if ((project.my_open_voiceover_action_comment_count || 0) > 0) {
    badges.push("Озвучка");
  }
  return badges;
}

function normalizedActionFocusReason(project: ProjectListItem): string {
  if ((project.my_open_action_comment_count || 0) > 0) {
    return "Назначенная правка ждет выполнения";
  }
  if ((project.my_in_progress_action_comment_count || 0) > 0) {
    return "Задача в работе требует обновления";
  }
  if (
    (project.my_recently_resolved_action_comment_count || 0) > 0 &&
    (project.open_action_comment_count || 0) > 0
  ) {
    return "Закрытая задача переоткрыта";
  }
  if ((project.my_recently_resolved_action_comment_count || 0) > 0) {
    return "Недавно закрытые задачи";
  }
  if ((project.open_action_comment_count || 0) > 0) {
    return "Есть открытые правки без назначения";
  }
  return "Проект попал в рабочую очередь";
}

function buildMyActionQueueItems(items: ProjectListItem[]): MyActionQueueItem[] {
  const result: MyActionQueueItem[] = [];

  for (const project of items) {
    const openCount = project.my_open_action_comment_count || 0;
    const inProgressCount = project.my_in_progress_action_comment_count || 0;
    const recentlyResolvedCount = project.my_recently_resolved_action_comment_count || 0;
    const targetBadges = actionTargetBadges(project);

    if (openCount > 0) {
      result.push({
        project,
        stage: "open",
        tone: "warn",
        title: "Назначенная правка ждет выполнения",
        detail: `Открытых назначенных правок: ${openCount}.`,
        count: openCount,
        targetBadges
      });
    }
    if (inProgressCount > 0) {
      result.push({
        project,
        stage: "in_progress",
        tone: "fresh",
        title: "Задача в работе требует обновления",
        detail: `Задач в статусе «в работе»: ${inProgressCount}.`,
        count: inProgressCount,
        targetBadges
      });
    }
    if (recentlyResolvedCount > 0) {
      result.push({
        project,
        stage: "recently_resolved",
        tone: "muted",
        title: "Недавно закрытые задачи",
        detail: `Закрыто за последние 3 дня: ${recentlyResolvedCount}.`,
        count: recentlyResolvedCount,
        targetBadges: []
      });
    }
  }

  const stageWeight: Record<ActionQueueStage, number> = {
    open: 0,
    in_progress: 1,
    recently_resolved: 2
  };

  return result.sort((left, right) => {
    const stageDelta = stageWeight[left.stage] - stageWeight[right.stage];
    if (stageDelta !== 0) {
      return stageDelta;
    }
    const countDelta = right.count - left.count;
    if (countDelta !== 0) {
      return countDelta;
    }
    return right.project.id - left.project.id;
  });
}

function collectMyWorkItems(project: ProjectListItem, user: UserPublic): MyWorkItem[] {
  const result: MyWorkItem[] = [];

  if ((project.open_action_comment_count || 0) > 0) {
    if ((project.my_open_edit_action_comment_count || 0) > 0) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по монтажу",
        detail: `На вас назначено правок по монтажу: ${project.my_open_edit_action_comment_count || 0}.`
      });
    }
    if ((project.my_open_titles_action_comment_count || 0) > 0) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по титрам",
        detail: `На вас назначено правок по титрам: ${project.my_open_titles_action_comment_count || 0}.`
      });
    }
    if ((project.my_open_text_action_comment_count || 0) > 0) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по тексту",
        detail: `На вас назначено правок по тексту: ${project.my_open_text_action_comment_count || 0}.`
      });
    }
    if ((project.my_open_voiceover_action_comment_count || 0) > 0) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по озвучке",
        detail: `На вас назначено правок по озвучке: ${project.my_open_voiceover_action_comment_count || 0}.`
      });
    }
    if (
      (project.my_open_action_comment_count || 0) === 0 &&
      project.edit_assignee_user_id === user.id &&
      (project.open_edit_action_comment_count || 0) > 0
    ) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по монтажу без исполнителя",
        detail: `По монтажу открыто ${project.open_edit_action_comment_count || 0} правок без прямого назначения на пользователя.`
      });
    }
    if (
      (project.my_open_action_comment_count || 0) === 0 &&
      project.titles_assignee_user_id === user.id &&
      (project.open_titles_action_comment_count || 0) > 0
    ) {
      result.push({
        project,
        tone: "warn",
        title: "Есть открытые правки по титрам без исполнителя",
        detail: `По титрам открыто ${project.open_titles_action_comment_count || 0} правок без прямого назначения на пользователя.`
      });
    }
  }

  if (project.author_user_id === user.id) {
    if ((project.text_seq || 0) < 1) {
      result.push({
        project,
        tone: "warn",
        title: "Нужно начать текст",
        detail: "В карточке пока нет сохраненного текста."
      });
    } else if (!project.current_text_seq) {
      result.push({
        project,
        tone: "warn",
        title: "Нужно назначить текущий текст",
        detail: "Текст уже есть, но текущее состояние еще не назначено."
      });
    } else if (!project.current_text_is_latest) {
      result.push({
        project,
        tone: "warn",
        title: "Текущий текст устарел",
        detail: "В рабочем тексте появились новые правки после последней передачи."
      });
    }
  }

  if (project.proofreader_user_id === user.id) {
    if (!project.current_text_seq) {
      result.push({
        project,
        tone: "muted",
        title: "Ждем текущий текст для корректуры",
        detail: "Корректура начнется после назначения текущей версии текста."
      });
    } else if (!project.proofread_text_is_current) {
      result.push({
        project,
        tone: "warn",
        title: "Нужна вычитка",
        detail: "Текущий текст новее последней вычитанной версии."
      });
    }
  }

  if (project.titles_assignee_user_id === user.id) {
    if (project.titles_requires_resync) {
      result.push({
        project,
        tone: "warn",
        title: "Титры надо пересинхронизировать",
        detail: "Текст изменился после того, как титры уже были взяты в работу."
      });
    } else if (!project.titles_text_seq && project.latest_text_is_proofread) {
      result.push({
        project,
        tone: "fresh",
        title: "Можно брать текст в титры",
        detail: "Есть вычитанная версия текста, готовая для титрования."
      });
    }
  }

  if (project.edit_assignee_user_id === user.id) {
    if (project.edit_requires_resync) {
      result.push({
        project,
        tone: "warn",
        title: "Монтаж на старой передаче",
        detail: "Текущий текст изменился после последней синхронизации монтажа."
      });
    } else if (!project.edit_text_seq && project.current_text_seq) {
      result.push({
        project,
        tone: "fresh",
        title: "Можно брать текущий текст в монтаж",
        detail: "Для монтажа уже назначена текущая версия текста."
      });
    }
  }

  return result;
}

function buildMyWorkState(items: ProjectListItem[], user: UserPublic): MyWorkState {
  const itemsList: MyWorkItem[] = [];
  const byProjectId: Record<number, MyWorkItem[]> = {};

  for (const project of items) {
    const projectItems = collectMyWorkItems(project, user);
    if (projectItems.length > 0) {
      byProjectId[project.id] = projectItems;
      itemsList.push(...projectItems);
    }
  }

  const sortedItems = itemsList.sort((left, right) => {
    const toneWeight = { warn: 0, fresh: 1, muted: 2 };
    const toneDelta = toneWeight[left.tone] - toneWeight[right.tone];
    if (toneDelta !== 0) {
      return toneDelta;
    }
    return right.project.id - left.project.id;
  });

  return {
    items: sortedItems,
    byProjectId
  };
}

function quickFilterMatches(project: ProjectListItem, user: UserPublic, filter: QueueFilterKey): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "my_work") {
    return collectMyWorkItems(project, user).length > 0;
  }
  if (filter === "my_actions") {
    return (
      (project.my_open_action_comment_count || 0) > 0 ||
      (project.my_in_progress_action_comment_count || 0) > 0 ||
      (project.my_recently_resolved_action_comment_count || 0) > 0
    );
  }
  if (filter === "open_actions") {
    return (project.open_action_comment_count || 0) > 0;
  }
  if (filter === "text") {
    return (
      (project.my_open_text_action_comment_count || project.open_text_action_comment_count || 0) > 0 ||
      !project.current_text_seq ||
      !project.current_text_is_latest ||
      !project.latest_text_is_proofread
    );
  }
  if (filter === "edit") {
    return (
      (project.my_open_edit_action_comment_count || project.open_edit_action_comment_count || 0) > 0 ||
      !!project.edit_requires_resync ||
      (!project.edit_text_seq && !!project.current_text_seq)
    );
  }
  if (filter === "titles") {
    return (
      (project.my_open_titles_action_comment_count || project.open_titles_action_comment_count || 0) > 0 ||
      !!project.titles_requires_resync ||
      (!project.titles_text_seq && !!project.latest_text_is_proofread)
    );
  }
  return (
    (project.my_open_voiceover_action_comment_count || project.open_voiceover_action_comment_count || 0) > 0 ||
    !!project.voiceover_requires_resync ||
    (!project.voiceover_text_seq && !!project.latest_text_is_proofread)
  );
}

function quickFilterReasons(
  project: ProjectListItem,
  user: UserPublic,
  filter: QueueFilterKey,
  myWorkByProjectId: Record<number, MyWorkItem[]>
): string[] {
  if (filter === "my_work") {
    return Array.from(new Set((myWorkByProjectId[project.id] || []).map((item) => item.title)));
  }

  if (filter === "my_actions") {
    return [normalizedActionFocusReason(project)];
  }

  const reasons: string[] = [];

  if (filter === "open_actions") {
    return [normalizedActionFocusReason(project)];
  }

  if (filter === "text") {
    if (!project.current_text_seq) {
      reasons.push("Нет текущей версии текста");
    } else if (!project.current_text_is_latest) {
      reasons.push("Текущий текст устарел");
    }
    if (!project.latest_text_is_proofread) {
      reasons.push("Нужна вычитка текущего текста");
    }
    if ((project.my_open_text_action_comment_count || 0) > 0) {
      reasons.push(`Назначено мне: ${project.my_open_text_action_comment_count || 0}`);
    }
    if ((project.open_text_action_comment_count || 0) > 0) {
      reasons.push(`Есть открытые текстовые правки: ${project.open_text_action_comment_count || 0}`);
    }
  }

  if (filter === "edit") {
    if (project.edit_requires_resync) {
      reasons.push("Монтаж на старой передаче текста");
    } else if (!project.edit_text_seq && project.current_text_seq) {
      reasons.push("Монтаж можно брать в работу");
    }
    if ((project.my_open_edit_action_comment_count || 0) > 0) {
      reasons.push(`Назначено мне: ${project.my_open_edit_action_comment_count || 0}`);
    }
    if ((project.open_edit_action_comment_count || 0) > 0) {
      reasons.push(`Есть открытые правки по монтажу: ${project.open_edit_action_comment_count || 0}`);
    }
  }

  if (filter === "titles") {
    if (project.titles_requires_resync) {
      reasons.push("Титры требуют пересинхронизации");
    } else if (!project.titles_text_seq && project.latest_text_is_proofread) {
      reasons.push("Есть текст, готовый для титров");
    }
    if ((project.my_open_titles_action_comment_count || 0) > 0) {
      reasons.push(`Назначено мне: ${project.my_open_titles_action_comment_count || 0}`);
    }
    if ((project.open_titles_action_comment_count || 0) > 0) {
      reasons.push(`Есть открытые правки по титрам: ${project.open_titles_action_comment_count || 0}`);
    }
  }

  if (filter === "voiceover") {
    if (project.voiceover_requires_resync) {
      reasons.push("Озвучка на старом тексте");
    } else if (!project.voiceover_text_seq && project.latest_text_is_proofread) {
      reasons.push("Есть вычитанный текст для озвучки");
    }
    if ((project.my_open_voiceover_action_comment_count || 0) > 0) {
      reasons.push(`Назначено мне: ${project.my_open_voiceover_action_comment_count || 0}`);
    }
    if ((project.open_voiceover_action_comment_count || 0) > 0) {
      reasons.push(`Есть открытые правки по озвучке: ${project.open_voiceover_action_comment_count || 0}`);
    }
  }

  if (filter === "all") {
    return Array.from(new Set((myWorkByProjectId[project.id] || []).map((item) => item.title))).slice(0, 3);
  }

  if (reasons.length === 0 && quickFilterMatches(project, user, filter)) {
    reasons.push("Проект попал в текущую рабочую очередь");
  }

  return reasons;
}

export default function MainPage({
  user,
  token,
  onLogout,
  onOpenEditor,
  onOpenChangePassword
}: MainPageProps) {
  const [activeSection, setActiveSection] = useState<AppSection>("my_work");
  const [view, setView] = useState<ProjectsView>("main");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [rubricFilter, setRubricFilter] = useState("");
  const [participantFilter, setParticipantFilter] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [archivedByFilter, setArchivedByFilter] = useState("");
  const [archivedFrom, setArchivedFrom] = useState("");
  const [archivedTo, setArchivedTo] = useState("");
  const [queueFilter, setQueueFilter] = useState<QueueFilterKey>("all");
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showUserAdmin, setShowUserAdmin] = useState(false);
  const [userAdminLoading, setUserAdminLoading] = useState(false);
  const [userAdminAction, setUserAdminAction] = useState(false);
  const [managedUsers, setManagedUsers] = useState<UserListItem[]>([]);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserFullName, setNewUserFullName] = useState("");
  const [newUserJobTitle, setNewUserJobTitle] = useState("");
  const [newUserRole, setNewUserRole] = useState("author");
  const [lastTemporaryPassword, setLastTemporaryPassword] = useState("");

  const canCreate = user.role === "admin" || user.role === "editor" || user.role === "author";
  const canArchiveManage = user.role === "admin" || user.role === "editor";
  const canManageUsers = user.role === "admin";
  const selectedProject = items.find((item) => item.id === selectedProjectId) || null;
  const myWorkState = buildMyWorkState(items, user);
  const myWorkItems = myWorkState.items;
  const myActionQueueItems = buildMyActionQueueItems(items);
  const displayItems =
    view === "main"
      ? items.filter((item) => quickFilterMatches(item, user, queueFilter))
      : items;
  const queueFilterOptions: QueueFilterOption[] =
    view === "main"
      ? [
          {
            key: "all",
            title: "Весь список",
            detail: "Все активные карточки без дополнительного сужения.",
            tone: "muted",
            count: items.length
          },
          {
            key: "my_work",
            title: "Ждет меня",
            detail: "Карточки, где система ждет действия именно от вас.",
            tone: "warn",
            count: items.filter((item) => (myWorkState.byProjectId[item.id] || []).length > 0).length
          },
          {
            key: "my_actions",
            title: "Мои правки",
            detail: "Открытые, в работе и недавно закрытые назначенные правки.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "my_actions")).length
          },
          {
            key: "open_actions",
            title: "Есть правки",
            detail: "Хотя бы один открытый комментарий с требованием действия.",
            tone: "warn",
            count: items.filter((item) => (item.open_action_comment_count || 0) > 0).length
          },
          {
            key: "text",
            title: "Текст",
            detail: "Нет текущего текста, он устарел или нужна вычитка/текстовая правка.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "text")).length
          },
          {
            key: "edit",
            title: "Монтаж",
            detail: "Монтаж ждет передачу текста, работает на старом тексте или имеет открытые правки.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "edit")).length
          },
          {
            key: "titles",
            title: "Титры",
            detail: "Титры ждут вычитанный текст, требуют пересинхронизации или правок.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "titles")).length
          },
          {
            key: "voiceover",
            title: "Озвучка",
            detail: "Озвучка ждет вычитанный текст, требует пересинхронизации или правок.",
            tone: "fresh",
            count: items.filter((item) => quickFilterMatches(item, user, "voiceover")).length
          }
        ]
      : [];
  const activeQueueFilter =
    queueFilterOptions.find((option) => option.key === queueFilter) || null;
  const focusReasonsByProjectId =
    view === "main"
      ? Object.fromEntries(
          displayItems.map((item) => [
            item.id,
            quickFilterReasons(item, user, queueFilter, myWorkState.byProjectId)
          ])
        )
      : {};
  const actionQueueByStage: Record<ActionQueueStage, MyActionQueueItem[]> = {
    open: myActionQueueItems.filter((item) => item.stage === "open"),
    in_progress: myActionQueueItems.filter((item) => item.stage === "in_progress"),
    recently_resolved: myActionQueueItems.filter((item) => item.stage === "recently_resolved")
  };

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const filters = buildFilters({
        search,
        statusFilter,
        rubricFilter,
        participantFilter,
        createdFrom,
        createdTo,
        archivedByFilter,
        archivedFrom,
        archivedTo
      });
      const payload = await fetchProjects(view, filters, token);
      setItems(payload.items);
      setSelectedProjectId((prevSelectedId) =>
        payload.items.some((item) => item.id === prevSelectedId)
          ? prevSelectedId
          : null
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить список проектов"
      );
    } finally {
      setLoading(false);
    }
  }, [
    archivedByFilter,
    archivedFrom,
    archivedTo,
    createdFrom,
    createdTo,
    participantFilter,
    rubricFilter,
    search,
    statusFilter,
    token,
    view
  ]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const loadManagedUsers = useCallback(async () => {
    if (!canManageUsers) {
      return;
    }
    setUserAdminLoading(true);
    setError("");
    try {
      const payload = await fetchUsers(token);
      setManagedUsers(payload.items || []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось загрузить пользователей"
      );
    } finally {
      setUserAdminLoading(false);
    }
  }, [canManageUsers, token]);

  useEffect(() => {
    if (showUserAdmin) {
      void loadManagedUsers();
    }
  }, [loadManagedUsers, showUserAdmin]);

  async function runProjectAction(
    action: () => Promise<{ message: string; project: ProjectListItem }>,
    options?: { forceView?: ProjectsView; selectNewProject?: boolean }
  ): Promise<void> {
    setActionLoading(true);
    setError("");
    setSuccess("");
    try {
      const payload = await action();
      setSuccess(payload.message);

      const nextView = options?.forceView || view;
      if (options?.forceView && options.forceView !== view) {
        setView(options.forceView);
      }

      const filters = buildFilters({
        search,
        statusFilter,
        rubricFilter,
        participantFilter,
        createdFrom,
        createdTo,
        archivedByFilter,
        archivedFrom,
        archivedTo
      });
      const refreshed = await fetchProjects(nextView, filters, token);
      setItems(refreshed.items);

      if (options?.selectNewProject) {
        setSelectedProjectId(payload.project.id);
      } else {
        setSelectedProjectId((prevSelectedId) =>
          refreshed.items.some((item) => item.id === prevSelectedId)
            ? prevSelectedId
            : null
        );
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось выполнить действие"
      );
    } finally {
      setActionLoading(false);
    }
  }

  function resetFilters(): void {
    setSearch("");
    setStatusFilter([]);
    setRubricFilter("");
    setParticipantFilter("");
    setCreatedFrom("");
    setCreatedTo("");
    setArchivedByFilter("");
    setArchivedFrom("");
    setArchivedTo("");
    setQueueFilter("all");
  }

  function handleNavigate(section: AppSection): void {
    setActiveSection(section);
    setSelectedProjectId(null);

    if (section === "archive") {
      setView("archive");
      setQueueFilter("all");
      return;
    }

    setView("main");

    if (section === "my_work") {
      setQueueFilter("my_work");
    } else if (section === "management") {
      setQueueFilter("open_actions");
    } else if (section === "production") {
      setQueueFilter("edit");
    } else {
      setQueueFilter("all");
    }

    if (section === "admin" && canManageUsers) {
      setShowUserAdmin(true);
    }
  }

  function handleViewChange(nextView: ProjectsView): void {
    setView(nextView);
    setSelectedProjectId(null);
    setQueueFilter("all");
    setActiveSection(nextView === "archive" ? "archive" : "all_projects");
  }

  async function handleCreateEmptyProject(): Promise<void> {
    await runProjectAction(
      () => createEmptyProject(token),
      { forceView: "main", selectNewProject: true }
    );
    setActiveSection("all_projects");
  }

  async function handleCreateUser(): Promise<void> {
    if (!newUserUsername.trim()) {
      return;
    }
    setUserAdminAction(true);
    setError("");
    setSuccess("");
    try {
      const payload = await createUser(token, {
        username: newUserUsername.trim(),
        full_name: newUserFullName.trim() || null,
        job_title: newUserJobTitle.trim() || null,
        role: newUserRole,
      });
      setLastTemporaryPassword(`${payload.user.username}: ${payload.temporary_password}`);
      setSuccess(payload.message);
      setNewUserUsername("");
      setNewUserFullName("");
      setNewUserJobTitle("");
      setNewUserRole("author");
      await loadManagedUsers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось создать пользователя");
    } finally {
      setUserAdminAction(false);
    }
  }

  async function handleUpdateManagedUser(
    userId: number,
    payload: {
      full_name?: string | null;
      job_title?: string | null;
      role?: string | null;
      is_active?: boolean | null;
    }
  ): Promise<void> {
    setUserAdminAction(true);
    setError("");
    setSuccess("");
    try {
      const response = await updateUser(token, userId, payload);
      setSuccess(response.message);
      setManagedUsers((previous) =>
        previous.map((item) => (item.id === userId ? response.user : item))
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось обновить пользователя");
    } finally {
      setUserAdminAction(false);
    }
  }

  async function handleResetManagedUserPassword(userId: number): Promise<void> {
    setUserAdminAction(true);
    setError("");
    setSuccess("");
    try {
      const payload = await resetUserTemporaryPassword(token, userId);
      setLastTemporaryPassword(`${payload.user.username}: ${payload.temporary_password}`);
      setSuccess(payload.message);
      setManagedUsers((previous) =>
        previous.map((item) => (item.id === userId ? payload.user : item))
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось сбросить временный пароль"
      );
    } finally {
      setUserAdminAction(false);
    }
  }

  return (
    <AppShell
      user={user}
      activeSection={activeSection}
      onNavigate={handleNavigate}
      onLogout={onLogout}
      onOpenChangePassword={onOpenChangePassword}
    >
      <section className="workspace-header">
        <div>
          <p className="muted small">сегодня · рабочая очередь</p>
          <h2>{dashboardTitle(activeSection)}</h2>
          <p className="muted">
            Выбранный сюжет:{" "}
            <strong>{selectedProject ? `#${selectedProject.id} ${selectedProject.title}` : "-"}</strong>
          </p>
        </div>
        <button
          type="button"
          disabled={!canCreate || actionLoading}
          onClick={() => void handleCreateEmptyProject()}
        >
          Создать сюжет
        </button>
      </section>

      <ProjectSummaryStrip projects={items} user={user} />
      <p className="attention-line">
        Первым делом: сюжеты, где текст изменился после начала титров или монтажа.
      </p>
      <ProjectFiltersBar
        search={search}
        view={view}
        loading={loading}
        activeFilterKey={queueFilter}
        filterOptions={queueFilterOptions as ProjectQueueFilterOption[]}
        onSearchChange={setSearch}
        onViewChange={handleViewChange}
        onFilterChange={(value) => setQueueFilter(value as QueueFilterKey)}
        onRefresh={() => void loadProjects()}
        onReset={resetFilters}
      />
      <ProjectList
        projects={displayItems}
        user={user}
        selectedProjectId={selectedProjectId}
        onOpenProject={onOpenEditor}
        onSelectProject={setSelectedProjectId}
      />

      <section className="card dashboard-service-section">
      <div className="row between wrap">
        <div>
          <h2>Служебные действия и расширенные фильтры</h2>
          <p className="muted">
            Пользователь: <strong>{user.full_name || user.username}</strong> ({user.role})
          </p>
          {user.job_title ? <p className="muted">Должность: <strong>{user.job_title}</strong></p> : null}
          <p className="muted">
            Выбранный проект:{" "}
            <strong>{selectedProject ? `#${selectedProject.id} ${selectedProject.title}` : "-"}</strong>
          </p>
        </div>
        <div className="row wrap">
          {canManageUsers ? (
            <button
              type="button"
              className="secondary"
              onClick={() => setShowUserAdmin((previous) => !previous)}
            >
              {showUserAdmin ? "Скрыть пользователей" : "Пользователи"}
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={onOpenChangePassword}>
            Сменить пароль
          </button>
          <button type="button" onClick={onLogout} className="secondary">
            Выйти
          </button>
        </div>
      </div>

      <div className="row controls wrap">
        <select
          value={view}
          onChange={(event) => handleViewChange(event.target.value as ProjectsView)}
        >
          <option value="main">Основной список</option>
          <option value="archive">Архив</option>
        </select>
        <input
          placeholder="Поиск по названию"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="button" onClick={() => void loadProjects()} disabled={loading}>
          {loading ? "Загрузка..." : "Обновить"}
        </button>
        <button type="button" className="secondary" onClick={resetFilters}>
          Сбросить фильтры
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!selectedProjectId}
          onClick={() => {
            if (!selectedProjectId) {
              return;
            }
            onOpenEditor(selectedProjectId);
          }}
        >
          Открыть редактор
        </button>
      </div>

      <div className="card">
        <div className="row between wrap">
          <div>
            <h3>Что ждет меня</h3>
            <p className="muted">
              Карточки, где сейчас ожидается действие именно от вашей роли или вашего назначения.
            </p>
          </div>
          <p className="muted">
            Всего сигналов: <strong>{myWorkItems.length}</strong>
          </p>
        </div>
        {myWorkItems.length === 0 ? (
          <p className="muted">Сейчас для вашей учетной записи нет явных сигналов передачи текста.</p>
        ) : (
          <div className="my-work-grid">
            {myWorkItems.map((item) => (
              <button
                key={`${item.project.id}-${item.title}`}
                type="button"
                className={`my-work-card my-work-card-${item.tone}`}
                onClick={() => onOpenEditor(item.project.id)}
              >
                <span className="my-work-card-title">{item.title}</span>
                <strong>#{item.project.id} {item.project.title}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row between wrap">
          <div>
            <h3>Мои правки</h3>
            <p className="muted">
              Отдельная очередь назначенных правок: что ожидает выполнения, что уже взято в работу и что закрыто недавно.
            </p>
          </div>
          <p className="muted">
            Всего задач: <strong>{myActionQueueItems.length}</strong>
          </p>
        </div>
        {myActionQueueItems.length === 0 ? (
          <p className="muted">Сейчас нет назначенных задач по комментариям.</p>
        ) : (
          <div className="action-queue-layout">
            <div className="action-queue-column">
              <p className="action-queue-column-title">Ожидает выполнения</p>
              {actionQueueByStage.open.length === 0 ? (
                <p className="muted small">Нет задач в этой группе.</p>
              ) : (
                <div className="my-work-grid">
                  {actionQueueByStage.open.map((item) => (
                    <button
                      key={`${item.project.id}-${item.stage}`}
                      type="button"
                      className={`my-work-card my-work-card-${item.tone}`}
                      onClick={() => onOpenEditor(item.project.id)}
                    >
                      <span className="my-work-card-title">{item.title}</span>
                      <strong>#{item.project.id} {item.project.title}</strong>
                      <span>{item.detail}</span>
                      {item.targetBadges.length > 0 ? (
                        <span className="action-target-badge-row">
                          {item.targetBadges.map((badge) => (
                            <span key={`${item.project.id}-${item.stage}-${badge}`} className="action-target-badge">
                              {badge}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="action-queue-column">
              <p className="action-queue-column-title">В работе</p>
              {actionQueueByStage.in_progress.length === 0 ? (
                <p className="muted small">Нет задач в этой группе.</p>
              ) : (
                <div className="my-work-grid">
                  {actionQueueByStage.in_progress.map((item) => (
                    <button
                      key={`${item.project.id}-${item.stage}`}
                      type="button"
                      className={`my-work-card my-work-card-${item.tone}`}
                      onClick={() => onOpenEditor(item.project.id)}
                    >
                      <span className="my-work-card-title">{item.title}</span>
                      <strong>#{item.project.id} {item.project.title}</strong>
                      <span>{item.detail}</span>
                      {item.targetBadges.length > 0 ? (
                        <span className="action-target-badge-row">
                          {item.targetBadges.map((badge) => (
                            <span key={`${item.project.id}-${item.stage}-${badge}`} className="action-target-badge">
                              {badge}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="action-queue-column">
              <p className="action-queue-column-title">Недавно закрыто</p>
              {actionQueueByStage.recently_resolved.length === 0 ? (
                <p className="muted small">Нет задач в этой группе.</p>
              ) : (
                <div className="my-work-grid">
                  {actionQueueByStage.recently_resolved.map((item) => (
                    <button
                      key={`${item.project.id}-${item.stage}`}
                      type="button"
                      className={`my-work-card my-work-card-${item.tone}`}
                      onClick={() => onOpenEditor(item.project.id)}
                    >
                      <span className="my-work-card-title">{item.title}</span>
                      <strong>#{item.project.id} {item.project.title}</strong>
                      <span>{item.detail}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {canManageUsers && showUserAdmin ? (
        <div className="card">
          <div className="row between wrap">
            <div>
              <h3>Пользователи</h3>
              <p className="muted">
                Создание учеток, роли, деактивация и сброс временных паролей.
              </p>
            </div>
            <div className="row wrap">
              <button
                type="button"
                className="secondary"
                disabled={userAdminLoading || userAdminAction}
                onClick={() => void loadManagedUsers()}
              >
                {userAdminLoading ? "Загрузка..." : "Обновить пользователей"}
              </button>
            </div>
          </div>

          <div className="filters-grid">
            <label>
              Логин
              <input value={newUserUsername} onChange={(event) => setNewUserUsername(event.target.value)} />
            </label>
            <label>
              ФИО
              <input value={newUserFullName} onChange={(event) => setNewUserFullName(event.target.value)} />
            </label>
            <label>
              Должность
              <input value={newUserJobTitle} onChange={(event) => setNewUserJobTitle(event.target.value)} />
            </label>
            <label>
              Роль
              <select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value)}>
                {USER_ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="row controls wrap">
            <button
              type="button"
              disabled={userAdminAction || !newUserUsername.trim()}
              onClick={() => void handleCreateUser()}
            >
              {userAdminAction ? "Сохранение..." : "Создать пользователя"}
            </button>
            {lastTemporaryPassword ? (
              <span className="muted">
                Временный пароль: <strong>{lastTemporaryPassword}</strong>
              </span>
            ) : null}
          </div>

          <div className="workspace-list">
            {managedUsers.length === 0 ? <p className="muted">Пользователи не загружены</p> : null}
            {managedUsers.map((managedUser) => (
              <div key={managedUser.id} className="workspace-item">
                <p>
                  <strong>{managedUser.username}</strong> · {managedUser.is_active ? "активен" : "деактивирован"} ·{" "}
                  {managedUser.must_change_password ? "ждет смены пароля" : "пароль установлен"}
                </p>
                <div className="filters-grid">
                  <label>
                    ФИО
                    <input
                      value={managedUser.full_name || ""}
                      disabled={userAdminAction}
                      onChange={(event) =>
                        setManagedUsers((previous) =>
                          previous.map((item) =>
                            item.id === managedUser.id ? { ...item, full_name: event.target.value } : item
                          )
                        )
                      }
                    />
                  </label>
                  <label>
                    Должность
                    <input
                      value={managedUser.job_title || ""}
                      disabled={userAdminAction}
                      onChange={(event) =>
                        setManagedUsers((previous) =>
                          previous.map((item) =>
                            item.id === managedUser.id ? { ...item, job_title: event.target.value } : item
                          )
                        )
                      }
                    />
                  </label>
                  <label>
                    Роль
                    <select
                      value={managedUser.role}
                      disabled={userAdminAction}
                      onChange={(event) =>
                        setManagedUsers((previous) =>
                          previous.map((item) =>
                            item.id === managedUser.id ? { ...item, role: event.target.value } : item
                          )
                        )
                      }
                    >
                      {USER_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Активность
                    <select
                      value={managedUser.is_active ? "active" : "inactive"}
                      disabled={userAdminAction}
                      onChange={(event) =>
                        setManagedUsers((previous) =>
                          previous.map((item) =>
                            item.id === managedUser.id
                              ? { ...item, is_active: event.target.value === "active" }
                              : item
                          )
                        )
                      }
                    >
                      <option value="active">Активен</option>
                      <option value="inactive">Деактивирован</option>
                    </select>
                  </label>
                </div>
                <div className="row controls wrap">
                  <button
                    type="button"
                    className="secondary"
                    disabled={userAdminAction}
                    onClick={() =>
                      void handleUpdateManagedUser(managedUser.id, {
                        full_name: managedUser.full_name || null,
                        job_title: managedUser.job_title || null,
                        role: managedUser.role,
                        is_active: managedUser.is_active,
                      })
                    }
                  >
                    {userAdminAction ? "Сохранение..." : "Сохранить"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={userAdminAction}
                    onClick={() => void handleResetManagedUserPassword(managedUser.id)}
                  >
                    {userAdminAction ? "Сброс..." : "Сбросить временный пароль"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === "main" ? (
        <div className="card">
          <div className="row between wrap">
            <div>
              <h3>Рабочая очередь основного списка</h3>
              <p className="muted">
                Быстрый фокус по тем проектам, где сейчас есть действие, правка или явный сигнал передачи текста.
              </p>
            </div>
            <p className="muted">
              В таблице: <strong>{displayItems.length}</strong> из <strong>{items.length}</strong>
            </p>
          </div>
          <div className="queue-filter-grid">
            {queueFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`queue-filter-card queue-filter-card-${option.tone} ${
                  option.key === queueFilter ? "queue-filter-card-active" : ""
                }`}
                onClick={() => setQueueFilter(option.key)}
              >
                <span className="queue-filter-card-title">{option.title}</span>
                <strong>{option.count}</strong>
                <span>{option.detail}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card">
        <h3>Фильтры списка</h3>
        <div className="filters-grid">
          <label>
            Статусы
            <select
              multiple
              size={5}
              className="multi-select"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  Array.from(event.target.selectedOptions, (option) => option.value)
                )
              }
            >
              {PROJECT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Рубрика содержит
            <input
              value={rubricFilter}
              onChange={(event) => setRubricFilter(event.target.value)}
              placeholder="Новости, спецрепортаж..."
            />
          </label>

          <label>
            Участник содержит
            <input
              value={participantFilter}
              onChange={(event) => setParticipantFilter(event.target.value)}
              placeholder="Автор, исполнитель, корректор"
            />
          </label>

          <label>
            Создан от
            <input
              type="date"
              value={createdFrom}
              onChange={(event) => setCreatedFrom(event.target.value)}
            />
          </label>

          <label>
            Создан до
            <input
              type="date"
              value={createdTo}
              onChange={(event) => setCreatedTo(event.target.value)}
            />
          </label>
        </div>

        {view === "archive" ? (
          <div className="filters-grid">
            <label>
              Кто архивировал
              <input
                value={archivedByFilter}
                onChange={(event) => setArchivedByFilter(event.target.value)}
                placeholder="Логин пользователя"
              />
            </label>
            <label>
              Архивирован от
              <input
                type="date"
                value={archivedFrom}
                onChange={(event) => setArchivedFrom(event.target.value)}
              />
            </label>
            <label>
              Архивирован до
              <input
                type="date"
                value={archivedTo}
                onChange={(event) => setArchivedTo(event.target.value)}
              />
            </label>
          </div>
        ) : null}
      </div>

      <div className="row controls wrap">
        <button
          type="button"
          disabled={!canCreate || actionLoading}
          onClick={() => void handleCreateEmptyProject()}
        >
          Создать новый (пустой)
        </button>
        <button
          type="button"
          disabled={!canCreate || actionLoading}
          onClick={() =>
            void runProjectAction(
              () => cloneLastProject(token),
              { forceView: "main", selectNewProject: true }
            )
          }
        >
          Создать из последнего
        </button>
        <button
          type="button"
          disabled={!canCreate || actionLoading || !selectedProjectId}
          onClick={() => {
            if (!selectedProjectId) {
              return;
            }
            void runProjectAction(
              () => cloneSelectedProject(token, selectedProjectId),
              { forceView: "main", selectNewProject: true }
            );
          }}
        >
          Создать из выбранного
        </button>
        <button
          type="button"
          className="danger"
          disabled={view !== "main" || !canArchiveManage || actionLoading || !selectedProjectId}
          onClick={() => {
            if (!selectedProjectId) {
              return;
            }
            void runProjectAction(
              () => archiveProject(token, selectedProjectId),
              { forceView: "main", selectNewProject: false }
            );
          }}
        >
          В архив
        </button>
        <button
          type="button"
          className="secondary"
          disabled={view !== "archive" || !canArchiveManage || actionLoading || !selectedProjectId}
          onClick={() => {
            if (!selectedProjectId) {
              return;
            }
            void runProjectAction(
              () => restoreProject(token, selectedProjectId),
              { forceView: "archive", selectNewProject: false }
            );
          }}
        >
          Вернуть в основной список
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}

      <ProjectsTable
        items={displayItems}
        view={view}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        activeFocusTitle={view === "main" ? activeQueueFilter?.title || null : null}
        focusReasonsByProjectId={focusReasonsByProjectId}
      />
      </section>
    </AppShell>
  );
}
