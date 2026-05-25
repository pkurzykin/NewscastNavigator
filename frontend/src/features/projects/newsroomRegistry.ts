import { PROJECT_STATUS_LABELS } from "../../shared/labels";
import type { ProjectListItem, UserPublic } from "../../shared/types";

export type NewsroomRegistryViewKey =
  | "all"
  | "source"
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

export interface NewsroomRegistryViewOption {
  key: NewsroomRegistryViewKey;
  title: string;
  detail: string;
  tone: "warn" | "fresh" | "muted";
  count: number;
}

export interface NewsroomWorkItem {
  project: ProjectListItem;
  tone: "warn" | "fresh" | "muted";
  title: string;
  detail: string;
}

export interface NewsroomWorkState {
  items: NewsroomWorkItem[];
  byProjectId: Record<number, NewsroomWorkItem[]>;
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
  return "Сюжет попал в реестр по рабочим сигналам";
}

export function collectMyWorkItems(project: ProjectListItem, user: UserPublic): NewsroomWorkItem[] {
  const result: NewsroomWorkItem[] = [];

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
        detail: "Корректура начнется после назначения текущего текста."
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
        title: "Титры надо обновить",
        detail: "Текст изменился после того, как титры уже были взяты в работу."
      });
    } else if (!project.titles_text_seq && project.latest_text_is_proofread) {
      result.push({
        project,
        tone: "fresh",
        title: "Можно брать текст в титры",
        detail: "Есть вычитанный текст, готовый для титрования."
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
        detail: "Для монтажа уже назначен текст для передачи в производство."
      });
    }
  }

  return result;
}

export function buildMyWorkState(items: ProjectListItem[], user: UserPublic): NewsroomWorkState {
  const itemsList: NewsroomWorkItem[] = [];
  const byProjectId: Record<number, NewsroomWorkItem[]> = {};

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

export function assignedRoleReasons(project: ProjectListItem, user: UserPublic): string[] {
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

export function isAssignedToUser(project: ProjectListItem, user: UserPublic): boolean {
  return assignedRoleReasons(project, user).length > 0;
}

export function isProjectInProgress(project: ProjectListItem): boolean {
  if (project.status === "source") {
    return false;
  }
  return (
    ["draft", "reviewed", "in_editing", "in_proofreading"].includes(project.status) ||
    project.edit_status === "in_progress" ||
    project.titles_status === "in_progress" ||
    project.voiceover_status === "in_progress" ||
    (project.my_in_progress_action_comment_count || 0) > 0
  );
}

export function urgentSignalReasons(project: ProjectListItem): string[] {
  const reasons: string[] = [];

  if ((project.open_action_comment_count || 0) > 0) {
    reasons.push(`Открытые правки: ${project.open_action_comment_count || 0}`);
  }
  if (project.status === "source") {
    return reasons;
  }
  if (project.edit_requires_resync) {
    reasons.push("Монтаж на старом тексте");
  }
  if (project.titles_requires_resync) {
    reasons.push("Титры надо обновить");
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

export function quickFilterMatches(
  project: ProjectListItem,
  user: UserPublic,
  filter: NewsroomRegistryViewKey
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "source") {
    return project.status === "source";
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
    if (project.status === "source") {
      return false;
    }
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

export function quickFilterReasons(
  project: ProjectListItem,
  user: UserPublic,
  filter: NewsroomRegistryViewKey,
  myWorkByProjectId: Record<number, NewsroomWorkItem[]>
): string[] {
  if (filter === "source") {
    return project.status === "source" ? ["Исходники ждут оформления в сюжет"] : [];
  }

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
      reasons.push("Нет текущего текста");
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
      reasons.push("Титры требуют обновления");
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
    reasons.push("Сюжет попал в это представление реестра");
  }

  return reasons;
}
