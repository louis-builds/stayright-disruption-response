import { apiGet, apiPost } from "../../shared/api/client";
import type { CaseMessage, CaseOption, CaseSummary, ConfirmExecutionResult, PolicySummary, ProposeDeferDatesResult, Thread } from "./types";

export function fetchMyCases(includeClosed = false) {
  return apiGet<CaseSummary[]>(`/api/cases/mine?includeClosed=${includeClosed}`);
}

export function fetchCase(caseId: string) {
  return apiGet<CaseSummary>(`/api/cases/${caseId}`);
}

interface PagedResult<T> {
  list: T[];
  total: number;
}

export function fetchMessages(caseId: string, thread: Thread) {
  return apiGet<PagedResult<CaseMessage>>(`/api/cases/${caseId}/messages?page=1&pageSize=100&thread=${thread}`);
}

// 不触发 AI 的普通发消息接口——guest 在 coordinator 线程发消息走这个。
export function postMessage(caseId: string, content: string, thread: Thread) {
  return apiPost<CaseMessage>(`/api/cases/${caseId}/messages`, { content, thread });
}

export function postChatMessage(caseId: string, content: string) {
  return apiPost<CaseMessage[]>(`/api/cases/${caseId}/chat`, { content });
}

export function markThreadRead(caseId: string, thread: Thread) {
  return apiPost<null>(`/api/cases/${caseId}/messages/read?thread=${thread}`, {});
}

export function markMessageRead(caseId: string, messageId: string) {
  return apiPost<null>(`/api/cases/${caseId}/messages/${messageId}/read`, {});
}

export function voteMessage(caseId: string, messageId: string, vote: "like" | "dislike") {
  return apiPost<null>(`/api/cases/${caseId}/messages/${messageId}/vote`, { vote });
}

export function fetchOptions(caseId: string) {
  return apiGet<CaseOption[]>(`/api/cases/${caseId}/options`);
}

export function selectOption(caseId: string, optionId: string) {
  return apiPost<null>(`/api/cases/${caseId}/options/${optionId}/select`, {});
}

export function confirmExecution(caseId: string, optionId: string) {
  return apiPost<ConfirmExecutionResult>(`/api/cases/${caseId}/options/${optionId}/confirm-execution`, {});
}

export function proposeDeferDates(caseId: string, optionId: string, newCheckIn: string, newCheckOut: string) {
  return apiPost<ProposeDeferDatesResult>(`/api/cases/${caseId}/options/${optionId}/propose-dates`, { newCheckIn, newCheckOut });
}

export function fetchPolicy(caseId: string, optionId: string) {
  return apiGet<PolicySummary>(`/api/cases/${caseId}/options/${optionId}/policy`);
}
