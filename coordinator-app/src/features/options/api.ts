import { apiGet, apiPost, apiPut } from "../../shared/api/client";
import type { AdminOption, PushOptionsResult, PushOptionsStatus } from "./types";

export function listOptions(caseId: string) {
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
  return apiPost<PushOptionsResult>(`/api/coordinator/cases/${caseId}/options/push`, {});
}

export function fetchPushStatus(caseId: string) {
  return apiGet<PushOptionsStatus>(`/api/coordinator/cases/${caseId}/options/push-status`);
}
