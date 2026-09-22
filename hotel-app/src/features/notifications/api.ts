import { apiGet, apiPost } from "../../shared/api/client";
import type { NotificationItem, PagedResult } from "./types";

export function fetchNotifications(page = 1, pageSize = 30, unreadOnly = false) {
  return apiGet<PagedResult<NotificationItem>>(`/api/notifications?page=${page}&pageSize=${pageSize}&unreadOnly=${unreadOnly}`);
}

export function fetchUnreadCount() {
  return apiGet<{ count: number }>("/api/notifications/unread-count");
}

export function markNotificationRead(id: string) {
  return apiPost<null>(`/api/notifications/${id}/read`, {});
}
