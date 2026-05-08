export const PROJECT_STATUS_LABELS: Record<string, string> = {
  archived: "Архив",
  delivered: "Сдано",
  draft: "Черновик",
  in_editing: "В работе",
  in_proofreading: "На корректуре",
  ready: "Готово",
  reviewed: "На проверке",
};

export const PROJECT_STATUS_ORDER = [
  "draft",
  "reviewed",
  "in_editing",
  "in_proofreading",
  "ready",
  "delivered",
  "archived",
];

export const TRACK_STATUS_LABELS: Record<string, string> = {
  changes_requested: "Нужны правки",
  done: "Готово",
  in_progress: "В работе",
  not_started: "Не начато",
  review: "На проверке",
};

export const USER_ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  author: "Автор",
  designer: "Дизайнер",
  editor: "Шеф / редактор",
  montager: "Монтажер",
  proofreader: "Корректор",
};

export const USER_ROLE_ORDER = [
  "admin",
  "editor",
  "author",
  "proofreader",
  "montager",
  "designer",
];

export function projectStatusLabel(status?: string | null): string {
  return PROJECT_STATUS_LABELS[status || ""] || status || "-";
}

export function trackStatusLabel(status?: string | null): string {
  return TRACK_STATUS_LABELS[status || "not_started"] || status || "Не начато";
}

export function userRoleLabel(role?: string | null): string {
  return USER_ROLE_LABELS[role || ""] || role || "-";
}
