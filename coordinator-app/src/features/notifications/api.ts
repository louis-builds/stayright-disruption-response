import { apiGet, apiPost } from "../../shared/api/client";
import type { PagedResult } from "../../shared/api/types";
import type { NotificationItem } from "./types";

export function fetchNotifications(page = 1, pageSize = 20, unreadOnly = false) {
  return apiGet<PagedResult<NotificationItem>>(`/api/notifications?page=${page}&pageSize=${pageSize}&unreadOnly=${unreadOnly}`);
}

export function fetchUnreadCount() {
  return apiGet<{ count: number }>("/api/notifications/unread-count");
}

export function markNotificationRead(id: string) {
  return apiPost<null>(`/api/notifications/${id}/read`, {});
}
