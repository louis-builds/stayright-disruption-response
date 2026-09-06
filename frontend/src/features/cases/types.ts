export interface CaseSummary {
  id: string;
  // GetCaseAsync 返回细分的三态(awaiting_hotel/awaiting_guest/guest_selected),GetMyCasesAsync
  // (首页列表)目前还是原始 pending——两个接口暂时没统一,按各自实际返回的值处理。
  status: "pending" | "in_progress" | "closed" | "awaiting_hotel" | "awaiting_guest" | "guest_selected";
  statusLabel: string;
  priority: string;
  disruptionType: string | null;
  disruptionTitle: string | null;
  hotelName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  createdAt: string;
  // 只有 GetCaseAsync(案件详情页)会真算这三个，首页列表(GetMyCasesAsync)一律是 false/0/0。
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
  hotelImageUrl: string | null;
}

export type SenderRole = "system" | "ai" | "guest" | "coordinator";

// ai: 客人跟 AI 的对话(含自动转人工);coordinator: 客人跟协调员的人工对话，两条独立线程。
export type Thread = "ai" | "coordinator";

export interface CaseMessage {
  id: string;
  caseId: string;
  senderRole: SenderRole;
  content: string;
  vote: "like" | "dislike" | null;
  thread: Thread;
  createdAt: string;
  readAt: string | null;
}

export type OptionType = "defer" | "alternate" | "cancel" | "custom";
export type OptionAvailability = "pending" | "available" | "unavailable";

export interface CaseOption {
  id: string;
  optionType: OptionType;
  availability: OptionAvailability;
  selected: boolean;
  payloadJson: string;
  createdAt: string;
  customTitle: string | null;
  perkNames: string[];
}

export interface PolicySummary {
  excerpt: string | null;
  docName: string | null;
  docVersion: number | null;
  payloadJson: string;
}

export interface ConfirmExecutionResult {
  outcome: "success" | "processing" | "failed";
  message: string;
  newConfirmationNo: string | null;
  newCheckIn: string | null;
  newCheckOut: string | null;
}

export interface ProposeDeferDatesResult {
  success: boolean;
  message: string;
}
