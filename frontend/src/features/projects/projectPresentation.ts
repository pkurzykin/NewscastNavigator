import { formatDateTime } from "../../shared/date";
import { projectStatusLabel, trackStatusLabel } from "../../shared/labels";
import type { ProjectListItem } from "../../shared/types";

export type ProjectQueueTone = "ok" | "warn" | "muted";

export interface ProjectQueuePriorityState {
  label: string;
  tone: ProjectQueueTone;
}

export function textStateTone(project: ProjectListItem): ProjectQueueTone {
  if (!project.current_text_seq) {
    return "muted";
  }
  if (!project.current_text_is_latest || !project.latest_text_is_proofread) {
    return "warn";
  }
  return "ok";
}

export function textStateLabel(project: ProjectListItem): string {
  if (!project.current_text_seq) {
    return "Нет текущего текста";
  }
  if (!project.current_text_is_latest) {
    return "Текущий текст устарел";
  }
  if (!project.latest_text_is_proofread) {
    return "Нужна вычитка";
  }
  return "Текст готов";
}

export function currentTextSeqTone(project: ProjectListItem): ProjectQueueTone {
  if (!project.current_text_seq) {
    return "muted";
  }
  return project.current_text_is_latest ? "ok" : "warn";
}

export function proofreadTextSeqTone(project: ProjectListItem): ProjectQueueTone {
  if (!project.proofread_text_seq) {
    return "muted";
  }
  return project.latest_text_is_proofread ? "ok" : "warn";
}

export function trackTone(isResyncRequired?: boolean): ProjectQueueTone {
  return isResyncRequired ? "warn" : "muted";
}

export function projectOpenActionCount(project: ProjectListItem): number {
  return project.open_action_comment_count || 0;
}

export function projectFocusReasons(
  project: ProjectListItem,
  focusReasonsByProjectId?: Record<number, string[]>
): string[] {
  return focusReasonsByProjectId?.[project.id] || [];
}

export function projectQueuePriorityState(
  project: ProjectListItem,
  reasons: string[],
  openActions: number
): ProjectQueuePriorityState {
  const assignedActions =
    (project.my_open_action_comment_count || 0) + (project.my_in_progress_action_comment_count || 0);

  if (
    assignedActions > 0 ||
    openActions > 0 ||
    project.titles_requires_resync ||
    project.edit_requires_resync ||
    project.voiceover_requires_resync ||
    (!!project.current_text_seq && !project.current_text_is_latest)
  ) {
    return { label: "Срочно", tone: "warn" };
  }

  if (!project.current_text_seq || !project.latest_text_is_proofread || reasons.length > 0) {
    return { label: "В работе", tone: "muted" };
  }

  return { label: "Стабильно", tone: "ok" };
}

export function projectMainBlocker(project: ProjectListItem, reasons: string[] = []): string {
  if (reasons.length > 0) {
    return reasons[0];
  }
  if ((project.open_action_comment_count || 0) > 0) {
    return `Открытые правки: ${project.open_action_comment_count || 0}`;
  }
  if (project.edit_requires_resync) {
    return "Монтаж на старом тексте";
  }
  if (project.titles_requires_resync) {
    return "Титры надо обновить";
  }
  if (project.voiceover_requires_resync) {
    return "Озвучка на старом тексте";
  }
  if (!project.current_text_seq) {
    return "Нет текущего текста";
  }
  if (!project.current_text_is_latest) {
    return "Текущий текст устарел";
  }
  if (!project.latest_text_is_proofread) {
    return "Нужна вычитка";
  }
  return "Срочных блокеров нет";
}

export function projectTeamSummary(project: ProjectListItem): string[] {
  return [
    `Автор: ${project.author_username || "-"}`,
    `Исполнитель: ${project.executor_username || "-"}`,
    `Корректор: ${project.proofreader_username || "-"}`,
  ];
}

export function projectTrackSummary(project: ProjectListItem): string[] {
  return [
    `Монтаж: ${project.edit_requires_resync ? "обновить текст" : trackStatusLabel(project.edit_status)}`,
    `Титры: ${project.titles_requires_resync ? "обновить текст" : trackStatusLabel(project.titles_status)}`,
    `Озвучка: ${project.voiceover_requires_resync ? "обновить текст" : trackStatusLabel(project.voiceover_status)}`,
  ];
}

export function projectRegistryStage(project: ProjectListItem): string {
  return projectStatusLabel(project.status);
}

export function projectRegistryDateLabel(project: ProjectListItem, isArchive: boolean): string {
  if (isArchive) {
    return formatDateTime(project.archived_at);
  }
  return formatDateTime(project.status_changed_at || project.created_at);
}
