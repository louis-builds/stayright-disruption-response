import { apiGet, apiPost } from "../../shared/api/client";
import type { NotificationItem, PagedResult } from "./types";

export function fetchNotifications(page = 1, pageSize = 10, unreadOnly = false) {
  return apiGet<PagedResult<NotificationItem>>(`/api/notifications?page=${page}&pageSize=${pageSize}&unreadOnly=${unreadOnly}`);
}

export function markNotificationRead(id: string) {
  return apiPost<null>(`/api/notifications/${id}/read`, {});
}

export function markCaseNotificationsRead(caseId: string) {
  return apiPost<null>(`/api/notifications/case/${caseId}/read`, {});
}
