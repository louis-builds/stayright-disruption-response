export interface CaseQueueItem {
  caseId: string;
  confirmationNo: string;
  guestNickname: string;
  disruptionTitle: string;
  escalationReason: string | null;
  waitTime: string;
  priority: string;
  status: string;
  assigneeCoordinatorId: string | null;
  assigneeNickname: string | null;
  overdue: boolean;
  isHighValueGuest: boolean;
}

export type CaseQueueTab = "queue" | "todo" | "in_progress" | "closed" | "search";

export interface CaseSummary {
  id: string;
  status: string;
  statusLabel: string;
  priority: string;
  disruptionType: string | null;
  disruptionTitle: string | null;
  hotelName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  createdAt: string;
  escalated: boolean;
  unreadAiCount: number;
  unreadCoordinatorCount: number;
  disruptionId: string | null;
  disruptionDescription: string | null;
  confirmationNo: string | null;
  guestNickname: string | null;
  guestAvatarUrl: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  assigneeCoordinatorId: string | null;
  assigneeNickname: string | null;
  escalationReason: string | null;
  escalationReviewedAsReasonable: boolean | null;
  escalationReviewNote: string | null;
}

export type MessageThread = "ai" | "coordinator";

export interface CaseMessage {
  id: string;
  caseId: string;
  senderRole: string;
  content: string;
  vote: string | null;
  thread: MessageThread;
  createdAt: string;
  readAt: string | null;
}

export const CLOSE_REASONS: { value: string; label: string }[] = [
  { value: "改订成功结案", label: "Rebooking succeeded" },
  { value: "取消退款完成结案", label: "Cancel & refund" },
  { value: "客人自行关闭或超时结案", label: "Closed by guest / timed out" },
  { value: "人工决议结案", label: "Resolved manually" },
  { value: "误伤关闭", label: "Closed in error" },
  { value: "重复案合并关闭", label: "Merged with duplicate case" },
];
