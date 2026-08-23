import type { Language } from "../auth/types";

export interface UpdateProfilePayload {
  nickname: string;
  gender: string;
  language: Language;
  phone: string;
  avatarUrl?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface EmailChangeRequested {
  devCode: string;
  expiresAt: string;
}
