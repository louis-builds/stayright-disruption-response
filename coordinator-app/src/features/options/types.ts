// 跟后端 AdminOptionDto 对齐(backend/Features/Coordinator/OptionsAdminDtos.cs)。
export interface AdminOption {
  id: string;
  optionType: string;
  availability: string;
  selected: boolean;
  locked: boolean;
  unavailableReason: string | null;
  payloadJson: string;
  createdAt: string;
  customTitle: string | null;
  perkNames: string[];
  coordinatorVisibilityOverride: boolean | null;
  executionRequestedAt: string | null;
}

export interface PushOptionsResult {
  success: boolean;
  sentAt: string;
}

export interface PushOptionsStatus {
  canPush: boolean;
  state: string;
  lastAttemptAt: string | null;
}
