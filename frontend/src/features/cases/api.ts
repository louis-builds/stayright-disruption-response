import { apiGet, apiPost } from "../../shared/api/client";
import type { CaseMessage, CaseOption, CaseSummary, CaseWorkflowProgress, ConfirmExecutionResult, PolicySummary, ProposeDeferDatesResult, Thread } from "./types";

export function fetchMyCases(includeClosed = false) {
  return apiGet<CaseSummary[]>(`/api/cases/mine?includeClosed=${includeClosed}`);
}

export function fetchCase(caseId: string) {
  return apiGet<CaseSummary>(`/api/cases/${caseId}`);
}

export function fetchWorkflowProgress(caseId: string) {
  return apiGet<CaseWorkflowProgress[]>(`/api/cases/${caseId}/workflow-progress`);
}

export function fetchTopFaqQuestions() {
  return apiGet<{ text: string; askCount: number }[]>("/api/faq/top");
}

export function reviewEscalation(caseId: string, reasonable: boolean, note?: string) {
  return apiPost<null>(`/api/cases/${caseId}/escalation-review`, { reasonable, note });
}

interface PagedResult<T> {
  list: T[];
  total: number;
}

export function fetchMessages(caseId: string, thread: Thread) {
  return apiGet<PagedResult<CaseMessage>>(`/api/cases/${caseId}/messages?page=1&pageSize=100&thread=${thread}`);
}

// 永远隐式 "ai" 线程,只对 guest 开放(会触发 AI 自动回复)。
export function postChatMessage(caseId: string, content: string) {
  return apiPost<CaseMessage[]>(`/api/cases/${caseId}/chat`, { content });
}

// 不触发 AI 的普通发消息接口;guest 在 coordinator 线程回复、或协调员发消息都走这个。
export function postMessage(caseId: string, content: string, thread: Thread) {
  return apiPost<CaseMessage>(`/api/cases/${caseId}/messages`, { content, thread });
}

export function voteMessage(caseId: string, messageId: string, vote: "like" | "dislike") {
  return apiPost<null>(`/api/cases/${caseId}/messages/${messageId}/vote`, { vote });
}

export function markThreadRead(caseId: string, thread: Thread) {
  return apiPost<null>(`/api/cases/${caseId}/messages/read?thread=${thread}`, {});
}

export function markMessageRead(caseId: string, messageId: string) {
  return apiPost<null>(`/api/cases/${caseId}/messages/${messageId}/read`, {});
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
  return apiPost<ProposeDeferDatesResult>(`/api/cases/${caseId}/options/${optionId}/propose-dates`, {
    newCheckIn,
    newCheckOut,
  });
}

export function fetchPolicy(caseId: string, optionId: string) {
  return apiGet<PolicySummary>(`/api/cases/${caseId}/options/${optionId}/policy`);
}

export interface CaseActionPreview {
  hotelName: string;
  optionTitle: string;
  checkIn: string | null;
  checkOut: string | null;
}

// 邮件"一键确认"落地页用——免登录的公开接口,token 本身就是凭证。
export function verifyCaseAction(token: string) {
  return apiGet<CaseActionPreview>(`/api/case-actions/verify?token=${encodeURIComponent(token)}`);
}

export function executeCaseAction(token: string) {
  return apiPost<{ caseId: string }>(`/api/case-actions/execute`, { token });
}

// 客人标签(只给 hotel/coordinator 角色，客人 403)。
export interface GuestTags {
  isHighValueGuest: boolean;
  isReturningGuest: boolean;
  emotionallySensitive: boolean;
  aiDifficult: boolean;
  highRejectionRate: boolean;
  slowResponder: boolean;
  keepMessagesSimple: boolean;
  speakSlowly: boolean;
  stayPreference: string | null;
  customTags: { id: string; label: string; ownerRole: string }[];
}

export function fetchGuestTags(guestUserId: string) {
  return apiGet<GuestTags>(`/api/tags/guest/${guestUserId}`);
}
