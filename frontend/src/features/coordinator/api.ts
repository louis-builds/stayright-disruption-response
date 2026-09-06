import { apiGet, apiPost, apiPut } from "../../shared/api/client";
import type {
  AdminOption, AdminUser, BadCaseListItem, BadCaseReplay, CandidateBooking, CaseNote, CaseNotification, CaseQueueItem,
  CoordinatorOption, DisruptionDetail, DisruptionListItem, GoldenTest, GoldenTestRun, KnowledgeDashboard, KpiMetrics,
  OpsOverview, OverviewDto, RagDocument, RefundStatus, SevenDayTrendPoint, SystemSettings,
} from "./types";

export function fetchOverview() {
  return apiGet<OverviewDto>("/api/coordinator/overview");
}

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

export function fetchCoordinators() {
  return apiGet<CoordinatorOption[]>("/api/coordinator/coordinators");
}

export function transferCase(caseId: string, toCoordinatorId: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/transfer`, { toCoordinatorId });
}

export function closeCase(caseId: string, closeReason: string, resultSummary: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/close`, { closeReason, resultSummary });
}

export function fetchNotes(caseId: string) {
  return apiGet<CaseNote[]>(`/api/coordinator/cases/${caseId}/notes`);
}

export function addNote(caseId: string, body: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/notes`, { body });
}

export function setPriority(caseId: string, priority: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/priority`, { priority });
}

export function fetchDisruptions(type?: string) {
  return apiGet<DisruptionListItem[]>(`/api/coordinator/disruptions${type ? `?type=${type}` : ""}`);
}

export function fetchDisruption(id: string) {
  return apiGet<DisruptionDetail>(`/api/coordinator/disruptions/${id}`);
}

export function assignDisruption(id: string, toCoordinatorId: string) {
  return apiPost<null>(`/api/coordinator/disruptions/${id}/assign`, { toCoordinatorId });
}

export function adjustWindow(id: string, startAt: string, endAtOrWindow: string | null) {
  return apiPut<null>(`/api/coordinator/disruptions/${id}/window`, { startAt, endAtOrWindow });
}

export function resolveDisruption(id: string) {
  return apiPost<null>(`/api/coordinator/disruptions/${id}/resolve`, {});
}

export function fetchCandidates(id: string) {
  return apiGet<CandidateBooking[]>(`/api/coordinator/disruptions/${id}/candidates`);
}

export function excludeCandidate(id: string, bookingId: string, reason: string) {
  return apiPost<null>(`/api/coordinator/disruptions/${id}/candidates/exclude`, { bookingId, reason });
}

export function notifyCandidates(id: string, bookingIds: string[], priority: string) {
  return apiPost<{ notified: number }>(`/api/coordinator/disruptions/${id}/candidates/notify`, { bookingIds, priority });
}

export function fetchAdminOptions(caseId: string) {
  return apiGet<AdminOption[]>(`/api/coordinator/cases/${caseId}/options`);
}

export function updateOptionPayload(caseId: string, optionId: string, payload: Record<string, unknown>) {
  return apiPut<null>(`/api/coordinator/cases/${caseId}/options/${optionId}`, { payload });
}

export function markOptionUnavailable(caseId: string, optionId: string, reason: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/options/${optionId}/unavailable`, { reason });
}

export function setOptionVisibility(caseId: string, optionId: string, visible: boolean | null) {
  return apiPut<null>(`/api/coordinator/cases/${caseId}/options/${optionId}/visibility`, { visible });
}

export function lockOption(caseId: string, optionId: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/options/${optionId}/lock`, {});
}

export function unlockOption(caseId: string, optionId: string, reason: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/options/${optionId}/unlock`, { reason });
}

export function regenerateOptions(caseId: string) {
  return apiPost<null>(`/api/coordinator/cases/${caseId}/options/regenerate`, {});
}

export function pushOptions(caseId: string) {
  return apiPost<{ success: boolean; sentAt: string }>(`/api/coordinator/cases/${caseId}/options/push`, {});
}

export function fetchPushOptionsStatus(caseId: string) {
  return apiGet<import("./types").PushOptionsStatus>(`/api/coordinator/cases/${caseId}/options/push-status`);
}

export function fetchRefundStatus(caseId: string) {
  return apiGet<RefundStatus>(`/api/cases/${caseId}/refund`);
}

export function confirmRefund(caseId: string, amount: number, reason: string) {
  return apiPost<null>(`/api/cases/${caseId}/refund/confirm`, { amount, reason, optionId: null });
}

export function fetchCaseNotifications(caseId: string) {
  return apiGet<CaseNotification[]>(`/api/coordinator/cases/${caseId}/notifications`);
}

export function resendNotification(notificationId: string) {
  return apiPost<{ success: boolean; sentAt: string }>(`/api/coordinator/notifications/${notificationId}/resend`, {});
}

export function fetchBadCases() {
  return apiGet<BadCaseListItem[]>("/api/coordinator/bad-cases");
}

export function fetchBadCaseReplay(messageId: string) {
  return apiGet<BadCaseReplay>(`/api/coordinator/bad-cases/${messageId}/replay`);
}

export function confirmMissedEscalation(messageId: string, confirmed: boolean) {
  return apiPost<null>(`/api/coordinator/bad-cases/${messageId}/missed-escalation-review`, { confirmed });
}

export function fetchOpsOverview() {
  return apiGet<OpsOverview>("/api/coordinator/ops/overview");
}

export function fetchSevenDayTrend() {
  return apiGet<SevenDayTrendPoint[]>("/api/coordinator/ops/seven-day-trend");
}

export function fetchKpi(day?: string, disruptionId?: string) {
  const params = new URLSearchParams();
  if (day) params.set("day", day);
  if (disruptionId) params.set("disruptionId", disruptionId);
  const qs = params.toString();
  return apiGet<KpiMetrics>(`/api/coordinator/ops/kpi${qs ? `?${qs}` : ""}`);
}

export function acknowledgeAlert(alertKey: string) {
  return apiPost<null>("/api/coordinator/ops/alerts/acknowledge", { alertKey });
}

export function fetchDisruptionCases(disruptionId: string) {
  return apiGet<CaseQueueItem[]>(`/api/coordinator/disruptions/${disruptionId}/cases`);
}

export function fetchAdminUsers() {
  return apiGet<AdminUser[]>("/api/coordinator/users");
}

export function disableUser(userId: string, reason: string) {
  return apiPost<null>(`/api/coordinator/users/${userId}/disable`, { reason });
}

export function enableUser(userId: string) {
  return apiPost<null>(`/api/coordinator/users/${userId}/enable`, {});
}

export function resetUserPassword(userId: string) {
  return apiPost<{ temporaryPassword: string }>(`/api/coordinator/users/${userId}/reset-password`, {});
}

export function fetchKbDocuments() {
  return apiGet<RagDocument[]>("/api/coordinator/knowledge-base/documents");
}

export function uploadKbDocument(name: string, content: string, sourceType: string) {
  return apiPost<{ document: RagDocument; testRun: GoldenTestRun; setAsDefault: boolean }>(
    "/api/coordinator/knowledge-base/documents",
    { name, content, sourceType, effectiveFrom: null, effectiveUntil: null },
  );
}

export function setKbDefaultVersion(name: string, version: number) {
  return apiPost<null>(`/api/coordinator/knowledge-base/documents/${encodeURIComponent(name)}/default-version`, { version });
}

export function fetchGoldenTests() {
  return apiGet<GoldenTest[]>("/api/coordinator/knowledge-base/golden-tests");
}

export function addGoldenTest(input: string, expect: string, note: string) {
  return apiPost<null>("/api/coordinator/knowledge-base/golden-tests", { input, expect, note });
}

export function runGoldenTests() {
  return apiPost<GoldenTestRun>("/api/coordinator/knowledge-base/golden-tests/run", {});
}

export function fetchLatestGoldenTestRun() {
  return apiGet<GoldenTestRun | null>("/api/coordinator/knowledge-base/golden-tests/latest-run");
}

export function fetchKnowledgeDashboard() {
  return apiGet<KnowledgeDashboard>("/api/coordinator/knowledge-base/dashboard");
}

export function fetchSystemSettings() {
  return apiGet<SystemSettings>("/api/coordinator/users/settings");
}

export function updateSystemSettings(settings: SystemSettings) {
  return apiPut<SystemSettings>("/api/coordinator/users/settings", settings);
}
