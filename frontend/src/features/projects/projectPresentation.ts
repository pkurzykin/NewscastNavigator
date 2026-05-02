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
