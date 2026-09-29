import { Platform } from "react-native";
import { apiGet, apiPost, apiUpload, BASE_URL } from "../../shared/api/client";
import type { ApiResponse, PagedResult } from "../../shared/api/types";
import type { Call, CallRecording, CallsConfig } from "./types";

export function initiateCall(caseId: string, calleeType: CalleeType, simulateOutcome?: string) {
  return apiPost<Call>(`/api/cases/${caseId}/calls`, { calleeType, simulateOutcome });
}

export function listForCase(caseId: string) {
  return apiGet<Call[]>(`/api/cases/${caseId}/calls`);
}

export function endCall(callId: string) {
  return apiPost<null>(`/api/calls/${callId}/end`, {});
}

export interface MyCallsFilter {
  caseId?: string;
  calleeType?: CalleeType;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listMine(filter: MyCallsFilter = {}) {
  const params = new URLSearchParams();
  params.set("page", String(filter.page ?? 1));
  params.set("pageSize", String(filter.pageSize ?? 20));
  if (filter.caseId) params.set("caseId", filter.caseId);
  if (filter.calleeType) params.set("calleeType", filter.calleeType);
  if (filter.status) params.set("status", filter.status);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  return apiGet<PagedResult<Call>>(`/api/calls/mine?${params.toString()}`);
}

export function getCallsConfig() {
  return apiGet<CallsConfig>("/api/calls/config");
}

export async function uploadRecording(callId: string, file: { uri: string; name: string; type: string }) {
  if (Platform.OS === "web") {
    const blob = await fetch(file.uri).then((r) => r.blob());
    const form = new FormData();
    form.append("file", new File([blob], file.name, { type: file.type || blob.type || "audio/mpeg" }));
    const res = await fetch(`${BASE_URL}/api/calls/${callId}/recording`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    return (await res.json()) as ApiResponse<CallRecording>;
  }
  return apiUpload<CallRecording>(`/api/calls/${callId}/recording`, file);
}

export function getVoiceToken() {
  return apiGet<{ token: string; identity: string }>("/api/calls/voice-token");
}

export function placeBridge(callId: string) {
  return apiPost<null>(`/api/calls/${callId}/bridge`, {});
}

export function getRecording(callId: string) {
  return apiGet<CallRecording>(`/api/calls/${callId}/recording`);
}

export function reviewRecording(callId: string, reviewed: boolean, note?: string) {
  return apiPost<null>(`/api/calls/${callId}/recording/review`, { reviewed, note });
}

export function confirmInsights(
  callId: string,
  body: { keepMessagesSimple: boolean; speakSlowly: boolean; stayPreference: string | null },
) {
  return apiPost<CallRecording>(`/api/calls/${callId}/recording/insights`, body);
}
