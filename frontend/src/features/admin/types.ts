export type AdminTab = "recordings" | "users" | "kb" | "bad_cases";

export interface RecordingAuditListItem {
  callId: string;
  recordingId: string;
  caseId: string;
  coordinatorUserId: string;
  coordinatorNickname: string;
  guestNickname: string | null;
  confirmationNo: string | null;
  calleeType: string;
  startedAt: string;
  durationSeconds: number;
  processingStatus: string;
  auditRating: number | null;
  auditComment: string | null;
  auditedAt: string | null;
  auditedByNickname: string | null;
}

export interface RecordingAuditDetail extends RecordingAuditListItem {
  fileUrl: string;
  transcriptText: string | null;
  aiSummary: string | null;
  coordinatorNote: string | null;
}

export interface PagedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
