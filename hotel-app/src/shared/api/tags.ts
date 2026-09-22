import { apiDelete, apiGet, apiPost } from "./client";

export interface CustomTag {
  id: string;
  label: string;
  ownerRole: string;
}

export interface GuestTags {
  isHighValueGuest: boolean;
  isReturningGuest: boolean;
  emotionallySensitive: boolean;
  aiDifficult: boolean;
  highRejectionRate: boolean;
  slowResponder: boolean;
  customTags: CustomTag[];
}

export function fetchGuestTags(guestUserId: string) {
  return apiGet<GuestTags>(`/api/tags/guest/${guestUserId}`);
}

export function queryGuestTags(guestUserIds: string[]) {
  return apiPost<Record<string, GuestTags>>("/api/tags/query", { guestUserIds });
}

export function fetchCustomTags() {
  return apiGet<CustomTag[]>("/api/tags/custom");
}

export function createCustomTag(label: string) {
  return apiPost<CustomTag>("/api/tags/custom", { label });
}

export function deleteCustomTag(id: string) {
  return apiDelete<null>(`/api/tags/custom/${id}`);
}

export function applyTagToGuest(tagId: string, guestUserId: string) {
  return apiPost<null>(`/api/tags/custom/${tagId}/guests/${guestUserId}`, {});
}

export function removeTagFromGuest(tagId: string, guestUserId: string) {
  return apiDelete<null>(`/api/tags/custom/${tagId}/guests/${guestUserId}`);
}
