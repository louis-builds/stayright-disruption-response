import { apiGet, apiPost } from "../../shared/api/client";
import type { AuthUser, ForgotPasswordResult, LoginPayload, RegisterPayload, SystemHealth } from "./types";

export function fetchMe() {
  return apiGet<AuthUser>("/api/auth/me", { skipAuthRedirect: true });
}

export function fetchHealth() {
  return apiGet<SystemHealth>("/api/health", { skipAuthRedirect: true });
}

export function login(payload: LoginPayload) {
  return apiPost<AuthUser>("/api/auth/login", payload);
}

export function register(payload: RegisterPayload) {
  return apiPost<AuthUser>("/api/auth/register", payload);
}

export function logout() {
  return apiPost<null>("/api/auth/logout", {});
}

export function forgotPassword(email: string) {
  return apiPost<ForgotPasswordResult>("/api/auth/forgot-password", { email });
}
