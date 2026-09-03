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
  // 客人已对该 case 的 defer 方案点过 P7 确认(后端 ExecutionRequestedAt!=null)。defer 不再另发
  // H2 卡后，pending 的 H1 卡靠它升级成"客人已拍板，等你核实空房"。
  guestCommitted: boolean;
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
}

export interface HotelPerk {
  id: string;
  name: string;
}

export interface RoomType {
  id: string;
  name: string;
  description: string;
  amenities: string[];
  capacity: number;
  priceAmount: number;
  currency: string;
  imageUrls: string[];
}

export interface HotelProfile {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  imageUrls: string[];
  primaryImageIndex: number;
  roomTypes: RoomType[];
  perks: HotelPerk[];
}

export interface HotelRefundPolicy {
  id: string;
  content: string;
  structuredRulesJson?: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  isActive: boolean;
  updatedAt: string;
}

export interface UpsertHotelRefundPolicyRequest {
  content: string;
  structuredRulesJson?: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  isActive: boolean;
}
