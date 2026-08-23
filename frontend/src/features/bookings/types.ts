export interface BookingSummary {
  id: string;
  confirmationNo: string;
  status: "confirmed" | "cancelled" | "rebooked";
  hotelName: string;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  guestsCount: number;
  totalAmount: number;
  currency: string;
  contactName: string;
  contactPhone: string;
  caseId: string | null;
  caseStatus: string | null;
  caseCloseReason: string | null;
  refundConfirmed: boolean;
  refundAmount: number | null;
  updatedAt: string;
}
