import { apiPost, apiPut } from "../../shared/api/client";
import type { AuthUser } from "../auth/types";
import type { ChangePasswordPayload, EmailChangeRequested, UpdateProfilePayload } from "./types";

export function updateProfile(payload: UpdateProfilePayload) {
  return apiPut<AuthUser>("/api/users/me/profile", payload);
}

export function changePassword(payload: ChangePasswordPayload) {
  return apiPost<null>("/api/users/me/password", payload);
}

export function requestEmailChange(newEmail: string) {
  return apiPost<EmailChangeRequested>("/api/users/me/email/request-change", { newEmail });
}

export function confirmEmailChange(newEmail: string, code: string) {
  return apiPost<AuthUser>("/api/users/me/email/confirm-change", { newEmail, code });
}
