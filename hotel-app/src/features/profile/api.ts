import { apiDelete, apiGet, apiPost, apiPostForm, apiPut } from "../../shared/api/client";
import type { ExtractedRefundRules, HotelPerk, HotelProfile, HotelRefundPolicy, RoomType, UploadedDocument } from "./types";

export function fetchProfile() {
  return apiGet<HotelProfile>("/api/hotel/profile");
}

export function updateProfile(name: string, address: string, lat: number, lng: number, imageUrls: string[], primaryImageIndex: number) {
  return apiPut<null>("/api/hotel/profile", { name, address, lat, lng, imageUrls, primaryImageIndex });
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

export function fetchRefundPolicy() {
  return apiGet<HotelRefundPolicy | null>("/api/hotel/profile/refund-policy");
}

export interface UpsertRefundPolicyBody {
  content: string;
  structuredRulesJson?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  isActive: boolean;
}

export function updateRefundPolicy(body: UpsertRefundPolicyBody) {
  return apiPut<HotelRefundPolicy>("/api/hotel/profile/refund-policy", body);
}

export function uploadRefundPolicyFile(doc: UploadedDocument, body: Omit<UpsertRefundPolicyBody, "content">) {
  const form = new FormData();
  // RN 的 fetch FormData 对本地文件用 {uri, name, type} 这个特殊对象形状(不是真正的 File/Blob)；
  // Expo Web 上 document-picker 会给一个真正的 File 对象，两条平台分支都要支持。
  if (doc.file) {
    form.append("file", doc.file);
  } else {
    form.append("file", { uri: doc.uri, name: doc.name, type: doc.mimeType ?? "application/octet-stream" } as unknown as Blob);
  }
  if (body.structuredRulesJson) form.append("structuredRulesJson", body.structuredRulesJson);
  if (body.effectiveFrom) form.append("effectiveFrom", body.effectiveFrom);
  if (body.effectiveUntil) form.append("effectiveUntil", body.effectiveUntil);
  form.append("isActive", String(body.isActive));
  return apiPostForm<HotelRefundPolicy>("/api/hotel/profile/refund-policy/file", form);
}

export function extractRefundRules(content: string) {
  return apiPost<ExtractedRefundRules>("/api/hotel/profile/refund-policy/extract", { content });
}
