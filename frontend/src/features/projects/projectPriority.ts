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
