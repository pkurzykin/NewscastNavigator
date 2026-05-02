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
