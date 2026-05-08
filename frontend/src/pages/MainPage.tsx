import { useCallback, useEffect, useState } from "react";

import ProjectWorkQueue from "../components/ProjectWorkQueue";
import { sortProjectQueueItems } from "../features/projects/projectPriority";
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
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  USER_ROLE_LABELS,
  USER_ROLE_ORDER
} from "../shared/labels";

const PROJECT_STATUS_OPTIONS = PROJECT_STATUS_ORDER.map((value) => ({
  value,
  label: PROJECT_STATUS_LABELS[value]
}));

const USER_ROLE_OPTIONS = USER_ROLE_ORDER.map((value) => ({
  value,
  label: USER_ROLE_LABELS[value]
}));

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
  return "Проект попал в рабочую очередь";
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
        title: "Нужно назначить current",
        detail: "Текст уже есть, но handoff-состояние еще не назначено."
      });
    } else if (!project.current_text_is_latest) {
      result.push({
        project,
        tone: "warn",
        title: "Current текста устарел",
        detail: "В workspace появились новые правки после последнего handoff."
      });
    }
  }

  if (project.proofreader_user_id === user.id) {
    if (!project.current_text_seq) {
      result.push({
        project,
        tone: "muted",
        title: "Ждем current для корректуры",
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
        title: "Монтаж на старом handoff",
        detail: "Current текста изменился после последней синхронизации монтажа."
      });
    } else if (!project.edit_text_seq && project.current_text_seq) {
      result.push({
        project,
        tone: "fresh",
        title: "Можно брать current в монтаж",
        detail: "Для монтажа уже назначен handoff текста."
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
      reasons.push("Current текста устарел");
    }
    if (!project.latest_text_is_proofread) {
      reasons.push("Нужна вычитка current");
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
      reasons.push("Монтаж на старом handoff");
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
            title: "Весь MAIN",
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
            title: "Мои action-задачи",
            detail: "Открытые, в работе и недавно закрытые назначенные правки.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "my_actions")).length
          },
          {
            key: "open_actions",
            title: "Есть правки",
            detail: "Хотя бы один открытый комментарий с requires action.",
            tone: "warn",
            count: items.filter((item) => (item.open_action_comment_count || 0) > 0).length
          },
          {
            key: "text",
            title: "Текст",
            detail: "Нет current, current устарел или нужна вычитка/текстовая правка.",
            tone: "warn",
            count: items.filter((item) => quickFilterMatches(item, user, "text")).length
          },
          {
            key: "edit",
            title: "Монтаж",
            detail: "Монтаж ждет handoff, работает на старом тексте или имеет открытые правки.",
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
    <section className="main-workspace">
      <section className="main-hero">
        <div>
          <p className="muted small">newsroom workflow</p>
          <h2>{view === "archive" ? "Архив сюжетов" : "Рабочая очередь сюжетов"}</h2>
          <p className="muted">
            {user.full_name || user.username} · {user.role}
            {user.job_title ? ` · ${user.job_title}` : ""}
          </p>
        </div>
        <div className="main-user-actions">
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
      </section>

      <section className="main-command-center" aria-label="Управление рабочей очередью">
        <div className="main-toolbar" aria-label="Фильтры рабочей очереди">
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
              Основной список
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
          <div className="queue-filter-strip" aria-label="Быстрый фокус рабочей очереди">
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
              Сигналы: {myWorkItems.length} · action-задачи: {myActionTaskCount}
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
              Открыть редактор
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
