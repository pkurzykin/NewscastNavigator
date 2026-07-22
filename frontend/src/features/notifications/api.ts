import { apiRequest } from "../../shared/api/client";
import type {
  NotificationListResponse,
  NotificationReadAck,
  PersonalActionsResponse,
} from "./types";


export const NOTIFICATIONS_INVALIDATED_EVENT = "newscast:notifications-invalidated";

export function invalidateNotifications(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT));
}

export const fetchPersonalActions = (limit = 20) =>
  apiRequest<PersonalActionsResponse>(`/api/v1/me/actions?limit=${limit}`);

export const fetchNotifications = (limit = 50) =>
  apiRequest<NotificationListResponse>(`/api/v1/notifications?unread=true&limit=${limit}`);

export const readNotification = (notificationId: number) =>
  apiRequest<NotificationReadAck>(`/api/v1/notifications/${notificationId}/read`, {
    method: "POST",
    body: "{}",
  });
