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

export interface HotelPerk {
  id: string;
  name: string;
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
  structuredRulesJson: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  isActive: boolean;
  updatedAt: string;
  sourceFileName: string | null;
  sourceFileUrl: string | null;
}

export interface ExtractedRefundRules {
  freeCancellationHours: number | null;
  cancellationFeePercent: number | null;
  cancellationFeeFixed: number | null;
  currency: string | null;
  aiUsed: boolean;
}

// expo-document-picker 在原生平台给 {uri,name,mimeType}，在 Expo Web 上额外给一个真正的
// File 对象(file 字段)——上传时两条平台分支都要支持,见 api.ts 的 uploadRefundPolicyFile()。
export interface UploadedDocument {
  uri: string;
  name: string;
  mimeType?: string | null;
  file?: File;
}
