import { apiGet, apiPost, apiPut } from "../../shared/api/client";
import type { HotelPerk, InquiryItem, SelectedOptionItem } from "./types";

export function fetchInquiries(status?: string) {
  return apiGet<InquiryItem[]>(`/api/hotel/inquiries${status ? `?status=${status}` : ""}`);
}

export function confirmInquiry(id: string, newCheckIn?: string | null, newCheckOut?: string | null, note?: string) {
  return apiPost<null>(`/api/hotel/inquiries/${id}/confirm`, { newCheckIn: newCheckIn ?? null, newCheckOut: newCheckOut ?? null, note });
}

export function rejectInquiry(id: string, reason: string) {
  return apiPost<null>(`/api/hotel/inquiries/${id}/reject`, { reason });
}

export function fetchSelectedOptions() {
  return apiGet<SelectedOptionItem[]>("/api/hotel/selected-options");
}

export function confirmOption(optionId: string) {
  return apiPost<null>(`/api/hotel/selected-options/${optionId}/confirm`, {});
}

export function rejectOption(optionId: string, reason: string) {
  return apiPost<null>(`/api/hotel/selected-options/${optionId}/reject`, { reason });
}

export function setOptionPerks(optionId: string, perkNames: string[]) {
  return apiPut<null>(`/api/hotel/options/${optionId}/perks`, { perkNames });
}

export function createCustomOption(caseId: string, title: string, perkNames: string[]) {
  return apiPost<SelectedOptionItem>(`/api/hotel/cases/${caseId}/custom-option`, { title, perkNames });
}

export interface ProfileSummary {
  name: string;
  address: string;
  perks: HotelPerk[];
  roomTypes: unknown[];
}

export function fetchProfileSummary() {
  return apiGet<ProfileSummary>("/api/hotel/profile");
}
