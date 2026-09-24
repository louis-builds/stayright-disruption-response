import { apiGet } from "../../shared/api/client";
import type { InquiryItem, SelectedOptionItem } from "../inbox/types";

export function fetchAllInquiries() {
  return apiGet<InquiryItem[]>("/api/hotel/inquiries");
}

export function fetchSelectedOptionsHistory() {
  return apiGet<SelectedOptionItem[]>("/api/hotel/selected-options/history");
}
