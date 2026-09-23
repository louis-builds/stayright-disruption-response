export type CallStatus = "ringing" | "in_progress" | "completed" | "rejected" | "no_answer" | "failed" | "connecting";
export interface CallSession {
  id: string; caseId: string; receiverUserId: string; calleeType: "guest" | "hotel";
  status: CallStatus; startedAt: string; answeredAt: string | null; endedAt: string | null;
  endedReason: string | null; durationSeconds: number | null;
  guestNickname?: string | null; hotelName?: string | null; confirmationNo?: string | null;
}
export interface IceCandidate { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; }
export interface IceServer { urls: string | string[]; username?: string; credential?: string; }
export interface AudioPeer {
  prepare(servers: IceServer[]): Promise<void>;
  offer(): Promise<string>;
  answer(sdp: string): Promise<string>;
  receiveAnswer(sdp: string): Promise<void>;
  addCandidate(candidate: IceCandidate): Promise<void>;
  mute(value: boolean): void;
  play(): Promise<void>;
  close(): void;
}
export interface PeerCallbacks {
  candidate(candidate: IceCandidate): void;
  state(state: string): void;
  playbackBlocked(): void;
}
export interface CallTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  invoke(method: string, ...args: unknown[]): Promise<void>;
  on(event: string, callback: (...args: any[]) => void): void;
  reconnected(callback: () => void): void;
  disconnected(callback: () => void): void;
}
export interface CallApi {
  create(caseId: string): Promise<CallSession>;
  get(id: string): Promise<CallSession>;
  incoming(): Promise<CallSession[]>;
  accept(id: string): Promise<CallSession>;
  reject(id: string): Promise<CallSession>;
  end(id: string): Promise<CallSession>;
  iceServers(): Promise<IceServer[]>;
}
export const terminal = (status: string) => ["completed", "rejected", "no_answer", "failed"].includes(status);
export interface CallView {
  call: CallSession | null;
  phase: "idle" | "preparing" | "incoming" | "ringing" | "connecting" | "connected" | "ended";
  online: boolean; busy: boolean; muted: boolean; playbackBlocked: boolean;
  error: string | null; connectedAt: number | null;
}
