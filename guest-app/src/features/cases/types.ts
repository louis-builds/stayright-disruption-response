export interface CaseSummary {
  id: string;
  status: "pending" | "in_progress" | "closed" | "awaiting_hotel" | "awaiting_guest" | "guest_selected";
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
  hotelImageUrl: string | null;
  assigneeNickname: string | null;
}

export type SenderRole = "system" | "ai" | "guest" | "coordinator";

// ai: 客人跟 AI 的对话(含自动转人工); coordinator: 客人跟协调员的人工对话,两条独立线程。
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
  attachmentJson: string | null;
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
