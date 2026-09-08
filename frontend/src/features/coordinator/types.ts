export interface OverviewDto {
  activeWeatherCount: number;
  activeFlightCount: number;
  activeRoadCount: number;
  newAffectedBookingsToday: number;
  pendingCount: number;
  inProgressCount: number;
  closedTodayCount: number;
  biggestImpactDisruptionId: string | null;
  biggestImpactDisruptionTitle: string | null;
  biggestImpactAffectedCount: number;
  overdueInProgressCount: number;
}

export interface CaseQueueItem {
  caseId: string;
  disruptionId: string;
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
  awaitingHotelConfirmation: boolean;
}

export interface CoordinatorOption {
  id: string;
  nickname: string;
}

export interface CaseNote {
  id: string;
  authorNickname: string;
  body: string;
  createdAt: string;
}

export interface RagDocument {
  id: string;
  name: string;
  version: number;
  isDefaultVersion: boolean;
  sourceType: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  chunkCount: number;
  createdAt: string;
}

export interface GoldenTest {
  id: string;
  input: string;
  expect: string;
  note: string;
}

export interface GoldenTestRunItem {
  input: string;
  expect: string;
  actual: string;
  passed: boolean;
}

export interface GoldenTestRun {
  id: string;
  triggerDocumentName: string | null;
  triggerVersion: number | null;
  passCount: number;
  failCount: number;
  createdAt: string;
  items: GoldenTestRunItem[];
}

export interface GoldenTestVersionPassRate {
  documentName: string;
  version: number;
  passRatePercent: number;
  failCount: number;
  runAt: string;
}

export interface KnowledgeDashboard {
  likeRatePercent: number;
  dislikeRatePercent: number;
  escalationRatePercent: number;
  totalAiReplies: number;
  likedCount: number;
  dislikedCount: number;
  escalatedCount: number;
  goldenTestPassRateByVersion: GoldenTestVersionPassRate[];
}

export interface SignalSourceStatus {
  type: string;
  configured: boolean;
  lastIngestedAt: string | null;
}

export interface AlertItem {
  key: string;
  level: string;
  message: string;
  acknowledged: boolean;
}

export interface KpiMetrics {
  firstNotifyRatePercent: number;
  firstNotifyNumerator: number;
  firstNotifyDenominator: number;
  rebookingRetentionPercent: number;
  rebookingNumerator: number;
  rebookingDenominator: number;
  avgResolutionHours: number | null;
  medianResolutionHours: number | null;
  concurrentInProgressCount: number;
  notifiedCount: number;
  resolvedCount: number;
  escalationDepth: number;
  escalationOverdueCount: number;
}

export interface OpsOverview {
  signalSources: SignalSourceStatus[];
  failedNotificationCount: number;
  hotelOverdueInquiryCount: number;
  escalationBacklogDepth: number;
  emailSuccessRatePercent: number;
  inAppSuccessRatePercent: number;
  databaseHealthy: boolean;
  alerts: AlertItem[];
  todayKpi: KpiMetrics;
}

export interface SevenDayTrendPoint {
  date: string;
  newCases: number;
  inProgress: number;
  awaitingGuest: number;
  awaitingHotel: number;
  closed: number;
}

export interface AdminUser {
  id: string;
  nickname: string;
  email: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  phone: string;
  gender: string;
  language: string;
  createdAt: string;
  hotelName: string | null;
}

export interface SystemSettings {
  unresolvedTurnThreshold: number;
  lowConfidenceEscalationEnabled: boolean;
  frustrationEscalationEnabled: boolean;
}

export interface BadCaseListItem {
  messageId: string;
  caseId: string;
  guestNickname: string;
  disruptionTitle: string;
  aiReplyExcerpt: string;
  createdAt: string;
  escalated: boolean;
  missedEscalationConfirmed: boolean | null;
}

export interface BadCaseReplay {
  messageId: string;
  caseId: string;
  precedingGuestQuestion: string | null;
  aiReply: string;
  analysis: string;
}

export interface DisruptionListItem {
  id: string;
  type: string;
  eventSubtype: string | null;
  severity: string | null;
  title: string;
  region: string;
  startAt: string;
  endAtOrWindow: string | null;
  status: string;
  affectedCount: number;
  assigneeCoordinatorId: string | null;
  assigneeNickname: string | null;
}

// lat/lng/radiusKm/rawSignalJson 只在详情里有——对齐 docs/handoff.jsonl 的 disruption_event.geo / raw_signal，
// 目前只有 weather/storm 这条对接链路会填，其它类型这几个字段是 null。
export interface DisruptionDetail extends DisruptionListItem {
  lat: number | null;
  lng: number | null;
  radiusKm: number | null;
  rawSignalText: string;
  rawSignalJson: string | null;
}

export interface CandidateBooking {
  bookingId: string;
  confirmationNo: string;
  guestNickname: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  isHighValueGuest: boolean;
}

export interface RefundStatus {
  confirmed: boolean;
  amount: number | null;
  reason: string | null;
  confirmedAt: string | null;
}

export interface CaseNotification {
  id: string;
  channel: string;
  type: string;
  title: string;
  body: string;
  success: boolean;
  sentAt: string;
}

export interface AdminOption {
  id: string;
  optionType: "defer" | "alternate" | "cancel" | "custom";
  availability: "pending" | "available" | "unavailable";
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

export interface PushOptionsStatus {
  canPush: boolean;
  state: "ready" | "sent" | "updated" | "retry" | "guest_confirmed";
  lastAttemptAt: string | null;
}
