export interface DoneItem {
  id: string;
  kind: "inquiry" | "option";
  confirmationNo: string;
  guestNickname: string;
  isReturningGuest: boolean;
  isHighValueGuest: boolean;
  guestUserId: string | null;
  label: string;
  statusTag: "accepted" | "rejected" | "confirmed" | "declined";
  timestamp: string;
  reason: string | null;
  finalOutcome: string | null;
  dateInfo: string | null;
}
