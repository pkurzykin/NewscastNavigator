export const PROJECT_STATUS_LABELS: Record<string, string> = {
  archived: "Архив",
  delivered: "Сдано",
  draft: "Черновик",
  in_editing: "В работе",
  in_proofreading: "На корректуре",
  ready: "Готово",
  reviewed: "На проверке",
  source: "Исходники",
};

export const PROJECT_STATUS_ORDER = [
  "source",
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

export const FINAL_REVIEW_STATUS_LABELS: Record<string, string> = {
  approved: "Утверждено",
  changes_requested: "Вернулось с правками",
  not_started: "Не отправлено",
  submitted: "Отправлено на согласование",
};

export const USER_ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  author: "Автор",
  designer: "Дизайнер",
  editor: "Шеф / редактор",
  montager: "Монтажер",
  operator: "Оператор",
  proofreader: "Корректор",
};

export const USER_ROLE_ORDER = [
  "admin",
  "editor",
  "author",
  "proofreader",
  "operator",
  "montager",
  "designer",
];

export function projectStatusLabel(status?: string | null): string {
  return PROJECT_STATUS_LABELS[status || ""] || status || "-";
}

export function trackStatusLabel(status?: string | null): string {
  return TRACK_STATUS_LABELS[status || "not_started"] || status || "Не начато";
}

export function finalReviewStatusLabel(status?: string | null): string {
  return FINAL_REVIEW_STATUS_LABELS[status || "not_started"] || status || "Не отправлено";
}

export function userRoleLabel(role?: string | null): string {
  return USER_ROLE_LABELS[role || ""] || role || "-";
}
