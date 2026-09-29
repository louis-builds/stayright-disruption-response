export type Role = "guest" | "coordinator" | "hotel" | "admin";
export type Language = "en" | "zh" | "mi";

export interface AuthUser {
  id: string;
  nickname: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  homeRoute: string;
  gender: string;
  language: Language;
  phone: string;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface RoomTypeInput {
  name: string;
  description: string;
  amenities: string[];
  capacity: number;
  priceAmount: number;
  currency: string;
  imageUrls: string[];
}

export interface HotelProfileInput {
  name: string;
  address: string;
  lat: number;
  lng: number;
  roomTypes: RoomTypeInput[];
}

export interface RegisterPayload {
  email: string;
  phone: string;
  nickname: string;
  gender: string;
  language: Language;
  password: string;
  confirmPassword: string;
  role: Role;
  avatarUrl?: string;
  hotel?: HotelProfileInput;
}

export interface LoginPayload {
  identifier: string;
  password: string;
  rememberMe: boolean;
}

export interface ForgotPasswordResult {
  resetLink: string;
  expiresAt: string;
}

export interface SystemHealth {
  status: string;
  database: string;
}
