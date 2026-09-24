export type CalleeType = "guest" | "hotel";
export type CallStatus = "connecting" | "ringing" | "in_progress" | "completed" | "failed" | "no_answer" | "rejected";
export type RecordingStatus = "pending" | "transcribing" | "summarizing" | "done" | "failed";

export type TelephonyProvider = "mock" | "twilio" | "system";

export interface Call {
  id: string;
  caseId: string;
  calleeType: CalleeType;
  status: CallStatus;
  startedAt: string;
  answeredAt?: string | null;
  endedReason?: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  guestNickname: string | null;
  hotelName: string | null;
  confirmationNo: string | null;
  provider?: TelephonyProvider;
  voiceEnabled?: boolean;
  calleePhone?: string | null;
  recordingStore?: "local" | "s3";
}

export interface CallsConfig {
  dialer: TelephonyProvider;
  recordingStore: "local" | "s3";
  twilioReady: boolean;
  voiceEnabled: boolean;
}

export interface CallRecording {
  id: string;
  callId: string;
  fileUrl: string;
  durationSeconds: number;
  transcriptText: string | null;
  aiSummary: string | null;
  processingStatus: RecordingStatus;
  reviewed: boolean;
  coordinatorNote: string | null;
}
