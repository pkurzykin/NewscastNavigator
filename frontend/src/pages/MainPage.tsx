import { useCallback, useEffect, useState } from "react";

import ProjectWorkQueue from "../components/ProjectWorkQueue";
import { projectQueuePriorityState } from "../features/projects/projectPresentation";
import { sortProjectQueueItems } from "../features/projects/projectPriority";
import {
  archiveProject,
  cloneLastProject,
  cloneSelectedProject,
  createEmptyProject,
  fetchProjects,
  restoreProject,
} from "../shared/api";
import type {
  ProjectFilters,
  ProjectListItem,
  ProjectsView,
  UserPublic,
} from "../shared/types";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
} from "../shared/labels";

const PROJECT_STATUS_OPTIONS = PROJECT_STATUS_ORDER.map((value) => ({
  value,
  label: PROJECT_STATUS_LABELS[value]
}));

interface MainPageProps {
  user: UserPublic;
  token: string;
  onOpenEditor: (projectId: number) => void;
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
  | "my_stories"
  | "assigned_to_me"
  | "waiting_me"
  | "in_progress"
  | "urgent"
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

interface MyWorkState {
  items: MyWorkItem[];
  byProjectId: Record<number, MyWorkItem[]>;
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
  return "Сюжет попал в список по рабочим сигналам";
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
        detail: "Текст уже есть, но состояние для передачи в производство еще не назначено."
      });
    } else if (!project.current_text_is_latest) {
      result.push({
        project,
        tone: "warn",
        title: "Текущий текст устарел",
        detail: "В рабочем тексте появились новые правки после последней передачи в производство."
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
        detail: "Current текста новее последней вычитанной версии."
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
        title: "Монтаж на старом тексте",
        detail: "Текущий текст изменился после последней передачи в монтаж."
      });
    } else if (!project.edit_text_seq && project.current_text_seq) {
      result.push({
        project,
        tone: "fresh",
        title: "Можно брать текущий текст в монтаж",
        detail: "Для монтажа уже назначена версия текста для передачи в производство."
      });
    }
  }

  return result;
}

function countMyActionTasks(items: ProjectListItem[]): number {
  return items.reduce(
    (total, project) =>
      total +
      (project.my_open_action_comment_count || 0) +
      (project.my_in_progress_action_comment_count || 0) +
      (project.my_recently_resolved_action_comment_count || 0),
    0
  );
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

function assignedRoleReasons(project: ProjectListItem, user: UserPublic): string[] {
  const reasons: string[] = [];
  const executorIds = project.executor_user_ids || [];

  if (project.author_user_id === user.id) {
    reasons.push("Автор текста");
  }
  if (project.executor_user_id === user.id || executorIds.includes(user.id)) {
    reasons.push("Исполнитель сюжета");
  }
  if (project.proofreader_user_id === user.id) {
    reasons.push("Корректор");
  }
  if (project.edit_assignee_user_id === user.id) {
    reasons.push("Монтаж");
  }
  if (project.titles_assignee_user_id === user.id) {
    reasons.push("Титры");
  }
  if ((project.my_open_action_comment_count || 0) > 0) {
    reasons.push("Назначенная правка");
  }

  return reasons;
}

function isAssignedToUser(project: ProjectListItem, user: UserPublic): boolean {
  return assignedRoleReasons(project, user).length > 0;
}

function isProjectInProgress(project: ProjectListItem): boolean {
  return (
    ["draft", "reviewed", "in_editing", "in_proofreading"].includes(project.status) ||
    project.edit_status === "in_progress" ||
    project.titles_status === "in_progress" ||
    project.voiceover_status === "in_progress" ||
    (project.my_in_progress_action_comment_count || 0) > 0
  );
}

function urgentSignalReasons(project: ProjectListItem): string[] {
  const reasons: string[] = [];

  if ((project.open_action_comment_count || 0) > 0) {
    reasons.push(`Открытые правки: ${project.open_action_comment_count || 0}`);
  }
  if (project.edit_requires_resync) {
    reasons.push("Монтаж на старом тексте");
  }
  if (project.titles_requires_resync) {
    reasons.push("Титры требуют синхронизации");
  }
  if (project.voiceover_requires_resync) {
    reasons.push("Озвучка на старом тексте");
  }
  if (project.current_text_seq && !project.current_text_is_latest) {
    reasons.push("Текущий текст устарел");
  }
  if (!project.current_text_seq) {
    reasons.push("Нет текущего текста");
  }
  if (!project.latest_text_is_proofread) {
    reasons.push("Нужна вычитка");
  }

  return reasons;
}

function quickFilterMatches(project: ProjectListItem, user: UserPublic, filter: QueueFilterKey): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "my_stories") {
    return isAssignedToUser(project, user);
  }
  if (filter === "assigned_to_me") {
    return isAssignedToUser(project, user);
  }
  if (filter === "waiting_me") {
    return collectMyWorkItems(project, user).length > 0;
  }
  if (filter === "in_progress") {
    return isProjectInProgress(project);
  }
  if (filter === "urgent") {
    return urgentSignalReasons(project).length > 0;
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
  if (filter === "my_stories") {
    return assignedRoleReasons(project, user);
  }

  if (filter === "assigned_to_me") {
    return assignedRoleReasons(project, user);
  }

  if (filter === "waiting_me") {
    return Array.from(new Set((myWorkByProjectId[project.id] || []).map((item) => item.title)));
  }

  if (filter === "in_progress") {
    const reasons: string[] = [];
    if (["draft", "reviewed", "in_editing", "in_proofreading"].includes(project.status)) {
      reasons.push(PROJECT_STATUS_LABELS[project.status as keyof typeof PROJECT_STATUS_LABELS] || "Сюжет в работе");
    }
    if (project.edit_status === "in_progress") {
      reasons.push("Монтаж в работе");
    }
    if (project.titles_status === "in_progress") {
      reasons.push("Титры в работе");
    }
    if (project.voiceover_status === "in_progress") {
      reasons.push("Озвучка в работе");
    }
    if ((project.my_in_progress_action_comment_count || 0) > 0) {
      reasons.push("Моя правка в работе");
    }
    return reasons;
  }

  if (filter === "urgent") {
    return urgentSignalReasons(project);
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
      reasons.push("Монтаж на старой версии текста");
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
    reasons.push("Сюжет попал в это представление списка");
  }

  return reasons;
}

export default function MainPage({
  user,
  token,
  onOpenEditor,
}: MainPageProps) {
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

  const canCreate = user.role === "admin" || user.role === "editor" || user.role === "author";
  const canArchiveManage = user.role === "admin" || user.role === "editor";
  const selectedProject = items.find((item) => item.id === selectedProjectId) || null;
  const myWorkState = buildMyWorkState(items, user);
  const myWorkItems = myWorkState.items;
  const myActionTaskCount = countMyActionTasks(items);
  const myWorkCountByProjectId = Object.fromEntries(
    Object.entries(myWorkState.byProjectId).map(([projectId, projectItems]) => [
      Number(projectId),
      projectItems.length
    ])
  );
  const displayItems = sortProjectQueueItems(
    view === "main"
      ? items.filter((item) => quickFilterMatches(item, user, queueFilter))
      : items,
    view,
    myWorkCountByProjectId
  );
  const queueFilterOptions: QueueFilterOption[] =
    view === "main"
      ? [
          {
            key: "all",
            title: "Все сюжеты",
            detail: "Все активные карточки общего реестра без дополнительного сужения.",
            tone: "muted",
            count: items.length
          },
          {
            key: "my_stories",
            title: "Мои сюжеты",
            detail: "Сюжеты, где вы указаны в рабочей роли или назначенной правке.",
            tone: "fresh",
            count: items.filter((item) => quickFilterMatches(item, user, "my_stories")).length
          },
          {
            key: "assigned_to_me",
            title: "Назначено мне",
            detail: "Сюжеты с вашим прямым участием: текст, корректура, монтаж, титры или правка.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "assigned_to_me")).length
          },
          {
            key: "waiting_me",
            title: "Ждет моего действия",
            detail: "Карточки, где система ждет действия именно от вас.",
            tone: "warn",
            count: items.filter((item) => (myWorkState.byProjectId[item.id] || []).length > 0).length
          },
          {
            key: "in_progress",
            title: "В работе",
            detail: "Сюжеты и производственные треки, которые сейчас находятся в работе.",
            tone: "fresh",
            count: items.filter((item) => quickFilterMatches(item, user, "in_progress")).length
          },
          {
            key: "urgent",
            title: "Срочные",
            detail: "Сюжеты с открытыми правками, устаревшим текстом или рассинхронизацией производства.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "urgent")).length
          },
          {
            key: "open_actions",
            title: "Правки",
            detail: "Хотя бы одна открытая правка требует действия.",
            tone: "warn",
            count: items.filter((item) => (item.open_action_comment_count || 0) > 0).length
          },
          {
            key: "text",
            title: "Текст",
            detail: "Нет текущего текста, текущий текст устарел или нужна вычитка/текстовая правка.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "text")).length
          },
          {
            key: "edit",
            title: "Монтаж",
            detail: "Монтаж ждет передачи текста, работает на старом тексте или имеет открытые правки.",
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
  const queueSummary = {
    shown: displayItems.length,
    urgent: view === "main"
      ? displayItems.filter((item) => projectQueuePriorityState(
          item,
          focusReasonsByProjectId[item.id] || [],
          item.open_action_comment_count || 0
        ).tone === "warn").length
      : 0,
    textWarnings:
      view === "main" ? items.filter((item) => quickFilterMatches(item, user, "text")).length : 0,
    openActions:
      view === "main" ? items.filter((item) => quickFilterMatches(item, user, "open_actions")).length : 0,
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

  return (
    <section className="main-workspace">
      <section className="main-hero">
        <div>
          <p className="muted small">общий реестр</p>
          <h2>{view === "archive" ? "Архив сюжетов" : "Список сюжетов"}</h2>
          <p className="muted">Единый список всех активных сюжетов, приоритетов и сигналов передачи текста.</p>
        </div>
      </section>

      <section className="main-command-center" aria-label="Управление списком сюжетов">
        <div className="queue-summary-strip" aria-label="Сводка списка сюжетов">
          <div>
            <span>Показано карточек</span>
            <strong>{queueSummary.shown}</strong>
          </div>
          <div>
            <span>Срочные сигналы</span>
            <strong>{queueSummary.urgent}</strong>
          </div>
          <div>
            <span>Текст требует внимания</span>
            <strong>{queueSummary.textWarnings}</strong>
          </div>
          <div>
            <span>Открытые правки</span>
            <strong>{queueSummary.openActions}</strong>
          </div>
        </div>

        <div className="main-toolbar" aria-label="Фильтры списка сюжетов">
          <div className="main-view-toggle" aria-label="Контур списка">
            <button
              type="button"
              className={view === "main" ? "active" : ""}
              onClick={() => {
                setView("main");
                setSelectedProjectId(null);
                setQueueFilter("all");
              }}
            >
              Активные сюжеты
            </button>
            <button
              type="button"
              className={view === "archive" ? "active" : ""}
              onClick={() => {
                setView("archive");
                setSelectedProjectId(null);
                setQueueFilter("all");
              }}
            >
              Архив
            </button>
          </div>
          <label className="main-search-field">
            Поиск
            <input
              placeholder="Название, рубрика, участник"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button type="button" onClick={() => void loadProjects()} disabled={loading}>
            {loading ? "Загрузка..." : "Обновить"}
          </button>
          <button type="button" className="secondary" onClick={resetFilters}>
            Сбросить
          </button>
        </div>

        {view === "main" ? (
          <div className="queue-filter-strip" aria-label="Представления списка сюжетов">
            {queueFilterOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`queue-filter-pill queue-filter-pill-${option.tone} ${
                  option.key === queueFilter ? "active" : ""
                }`}
                title={option.detail}
                onClick={() => setQueueFilter(option.key)}
              >
                <span>{option.title}</span>
                <strong>{option.count}</strong>
              </button>
            ))}
          </div>
        ) : null}

        <div className="project-action-strip">
          <div>
            <span className="muted small">Выбранный сюжет</span>
            <strong>{selectedProject ? `#${selectedProject.id} ${selectedProject.title}` : "не выбран"}</strong>
            <span className="muted small">
              Сигналы: {myWorkItems.length} · задачи правок: {myActionTaskCount}
            </span>
          </div>
          <div className="project-action-buttons">
            <button
              type="button"
              disabled={!canCreate || actionLoading}
              onClick={() =>
                void runProjectAction(
                  () => createEmptyProject(token),
                  { forceView: "main", selectNewProject: true }
                )
              }
            >
              Создать сюжет
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
              Открыть карточку
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!canCreate || actionLoading}
              onClick={() =>
                void runProjectAction(
                  () => cloneLastProject(token),
                  { forceView: "main", selectNewProject: true }
                )
              }
            >
              Из последнего
            </button>
            <button
              type="button"
              className="secondary"
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
              Из выбранного
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
              Вернуть
            </button>
          </div>
        </div>

        <details className="advanced-filter-panel">
          <summary>Расширенные фильтры</summary>
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
        </details>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {success ? <p className="success">{success}</p> : null}

      <ProjectWorkQueue
        items={displayItems}
        view={view}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onOpenProject={onOpenEditor}
        activeFocusTitle={view === "main" ? activeQueueFilter?.title || null : null}
        focusReasonsByProjectId={focusReasonsByProjectId}
      />
    </section>
  );
}
