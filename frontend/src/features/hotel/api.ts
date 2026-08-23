import { apiDelete, apiGet, apiPost, apiPut } from "../../shared/api/client";
import type { HotelPerk, HotelProfile, InquiryItem, RoomType, SelectedOptionItem } from "./types";

export function fetchInquiries(status?: string) {
  return apiGet<InquiryItem[]>(`/api/hotel/inquiries${status ? `?status=${status}` : ""}`);
}

export function confirmInquiry(id: string, note?: string) {
  return apiPost<null>(`/api/hotel/inquiries/${id}/confirm`, { newCheckIn: null, newCheckOut: null, note });
}

export function rejectInquiry(id: string, reason: string) {
  return apiPost<null>(`/api/hotel/inquiries/${id}/reject`, { reason });
}

export function fetchSelectedOptions() {
  return apiGet<SelectedOptionItem[]>("/api/hotel/selected-options");
}

export function fetchSelectedOptionsHistory() {
  return apiGet<SelectedOptionItem[]>("/api/hotel/selected-options/history");
}

export function confirmOption(optionId: string) {
  return apiPost<null>(`/api/hotel/selected-options/${optionId}/confirm`, {});
}

export function rejectOption(optionId: string, reason: string) {
  return apiPost<null>(`/api/hotel/selected-options/${optionId}/reject`, { reason });
}

export function fetchProfile() {
  return apiGet<HotelProfile>("/api/hotel/profile");
}

export function updateProfile(name: string, address: string, lat: number, lng: number) {
  return apiPut<null>("/api/hotel/profile", { name, address, lat, lng });
}

export function addRoomType(roomType: Omit<RoomType, "id">) {
  return apiPost<RoomType>("/api/hotel/profile/room-types", roomType);
}

export function updateRoomType(id: string, roomType: Omit<RoomType, "id">) {
  return apiPut<null>(`/api/hotel/profile/room-types/${id}`, roomType);
}

export function deleteRoomType(id: string) {
  return apiDelete<null>(`/api/hotel/profile/room-types/${id}`);
}

export function addPerk(name: string) {
  return apiPost<HotelPerk>("/api/hotel/profile/perks", { name });
}

export function deletePerk(id: string) {
  return apiDelete<null>(`/api/hotel/profile/perks/${id}`);
}

export function setOptionPerks(optionId: string, perkNames: string[]) {
  return apiPut<null>(`/api/hotel/options/${optionId}/perks`, { perkNames });
}

export function createCustomOption(caseId: string, title: string, perkNames: string[]) {
  return apiPost<SelectedOptionItem>(`/api/hotel/cases/${caseId}/custom-option`, { title, perkNames });
}
