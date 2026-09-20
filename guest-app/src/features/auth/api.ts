import { apiDelete, apiGet, apiPost } from "../../shared/api/client";
import type { AuthUser, ForgotPasswordResult, LoginRequest, RegisterRequest } from "./types";

export function login(request: LoginRequest) {
  return apiPost<AuthUser>("/api/auth/login", request);
}

export function register(request: RegisterRequest) {
  return apiPost<AuthUser>("/api/auth/register", request);
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

// 冷启动靠原生 Cookie 静默恢复会话时(不走 login()),也要把 user 信息填回去,
// 一次请求同时验证会话+拿到完整用户资料——协调员App第一版漏了这步,这次直接做对。
export function fetchMe() {
  return apiGet<AuthUser>("/api/auth/me");
}

export function registerPushToken(expoPushToken: string, platform: "ios" | "android") {
  return apiPost<null>("/api/push/register", { expoPushToken, platform });
}

export function unregisterPushToken(expoPushToken: string) {
  return apiDelete<null>(`/api/push/register?expoPushToken=${encodeURIComponent(expoPushToken)}`);
}
