export interface NotificationItem {
  id: string;
  channel: string;
  type: string;
  title: string;
  body: string;
  caseId: string | null;
  sentAt: string;
  readAt: string | null;
  success: boolean;
  disruptionType: string | null;
  disruptionTitle: string | null;
  affectedCheckIn: string | null;
  caseStatus: string | null;
}

export interface PagedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
