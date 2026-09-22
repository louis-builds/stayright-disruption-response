export interface InquiryItem {
  id: string;
  caseId: string;
  confirmationNo: string;
  guestNickname: string;
  disruptionTitle: string;
  checkIn: string;
  checkOut: string;
  roomTypeName: string;
  status: "pending" | "accepted" | "rejected";
  requestedAt: string;
  waitTime: string;
  overdue: boolean;
  isReturningGuest: boolean;
  isHighValueGuest: boolean;
  respondedAt: string | null;
  rejectReason: string | null;
  finalOutcome: "stayed" | "moved" | null;
  proposedNewCheckIn: string | null;
  proposedNewCheckOut: string | null;
  guestCommitted: boolean;
  guestUserId: string | null;
}

export interface SelectedOptionItem {
  optionId: string;
  caseId: string;
  confirmationNo: string;
  guestNickname: string;
  optionType: string;
  payloadJson: string;
  selectedSince: string;
  customTitle: string | null;
  perkNames: string[];
  isReturningGuest: boolean;
  isHighValueGuest: boolean;
  availability: "pending" | "available" | "unavailable";
  unavailableReason: string | null;
  guestUserId: string | null;
}

export interface HotelPerk {
  id: string;
  name: string;
}

export type TodoItem = { kind: "inquiry"; item: InquiryItem } | { kind: "option"; item: SelectedOptionItem };
