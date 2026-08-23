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
  isHighValueGuest: boolean;
  respondedAt: string | null;
  rejectReason: string | null;
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
  roomTypes: RoomType[];
  perks: HotelPerk[];
}
