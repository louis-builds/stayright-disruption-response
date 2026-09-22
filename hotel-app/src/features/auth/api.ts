import { apiGet, apiPost } from "../../shared/api/client";
import type { AuthUser, ForgotPasswordResult, LoginRequest } from "./types";

export function login(request: LoginRequest) {
  return apiPost<AuthUser>("/api/auth/login", request);
}

export function forgotPassword(email: string) {
  return apiPost<ForgotPasswordResult>("/api/auth/forgot-password", { email });
}

export function logout() {
  return apiPost<null>("/api/auth/logout", {});
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiPost<null>("/api/users/me/password", { currentPassword, newPassword });
}

// 冷启动靠原生 Cookie 静默恢复会话时(不走 login()),也要把 user 信息填回去。
export function fetchMe() {
  return apiGet<AuthUser>("/api/auth/me");
}
