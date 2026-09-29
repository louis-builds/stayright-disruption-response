import { apiGet, apiPost } from "../../shared/api/client";
import type { PagedResult, RecordingAuditDetail, RecordingAuditListItem } from "./types";

export function fetchRecordingsForAudit(params: {
  page?: number;
  pageSize?: number;
  q?: string;
  coordinatorId?: string;
  from?: string;
  to?: string;
  auditStatus?: string;
}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.coordinatorId) query.set("coordinatorId", params.coordinatorId);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.auditStatus) query.set("auditStatus", params.auditStatus);
  return apiGet<PagedResult<RecordingAuditListItem>>(`/api/admin/recordings?${query.toString()}`);
}

export function fetchRecordingForAudit(callId: string) {
  return apiGet<RecordingAuditDetail>(`/api/admin/recordings/${callId}`);
}

export function submitRecordingAudit(callId: string, rating: number, comment: string) {
  return apiPost<RecordingAuditDetail>(`/api/admin/recordings/${callId}/audit`, {
    rating,
    comment: comment.trim() || null,
  });
}

export function fetchMyCallAudits(page = 1, pageSize = 20) {
  return apiGet<PagedResult<RecordingAuditListItem>>(
    `/api/calls/audits/mine?page=${page}&pageSize=${pageSize}`,
  );
}
