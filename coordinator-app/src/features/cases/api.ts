import { apiGet, apiPost } from "../../shared/api/client";
import type { PagedResult } from "../../shared/api/types";
import type { CaseMessage, CaseQueueItem, CaseSummary, MessageThread } from "./types";

export function fetchQueue(filter?: string) {
  return apiGet<CaseQueueItem[]>(`/api/coordinator/queue${filter ? `?filter=${filter}` : ""}`);
}

export function fetchMine(status: "pending" | "in_progress") {
  return apiGet<CaseQueueItem[]>(`/api/coordinator/mine?status=${status}`);
}

export function fetchClosed(days = 7) {
  return apiGet<CaseQueueItem[]>(`/api/coordinator/closed?days=${days}`);
}

export function search(q: string) {
  return apiGet<CaseQueueItem[]>(`/api/coordinator/search?q=${encodeURIComponent(q)}`);
}

export function fetchCase(caseId: string) {
  return apiGet<CaseSummary>(`/api/cases/${caseId}`);
}

export function fetchMessages(caseId: string, thread: MessageThread) {
  return apiGet<PagedResult<CaseMessage>>(`/api/cases/${caseId}/messages?page=1&pageSize=100&thread=${thread}`);
}

export function postMessage(caseId: string, content: string, thread: MessageThread) {
  return apiPost<CaseMessage>(`/api/cases/${caseId}/messages`, { content, thread });
}

export function voteMessage(caseId: string, messageId: string, vote: "like" | "dislike") {
  return apiPost<null>(`/api/cases/${caseId}/messages/${messageId}/vote`, { vote });
}

export function markMessageRead(caseId: string, messageId: string) {
  return apiPost<null>(`/api/cases/${caseId}/messages/${messageId}/read`, {});
}

export function reviewEscalation(caseId: string, reasonable: boolean, note?: string) {
  return apiPost<null>(`/api/cases/${caseId}/escalation-review`, { reasonable, note });
}

export function closeCase(caseId: string, closeReason: string, resultSummary: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/close`, { closeReason, resultSummary });
}
