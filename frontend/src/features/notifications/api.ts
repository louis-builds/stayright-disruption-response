import { apiGet, apiPost } from "../../shared/api/client";
import type { NotificationItem, PagedResult } from "./types";

export function fetchNotifications(page = 1, pageSize = 10) {
  return apiGet<PagedResult<NotificationItem>>(`/api/notifications?page=${page}&pageSize=${pageSize}`);
}

export function fetchUnreadCount() {
  return apiGet<{ count: number }>("/api/notifications/unread-count");
}

export function markNotificationRead(id: string) {
  return apiPost<null>(`/api/notifications/${id}/read`, {});
}
