import { apiGet, apiPost } from "../../shared/api/client";
import type { AuthUser, LoginRequest } from "./types";

export function login(request: LoginRequest) {
  return apiPost<AuthUser>("/api/auth/login", request);
}

export function logout() {
  return apiPost<null>("/api/auth/logout", {});
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiPost<null>("/api/users/me/password", { currentPassword, newPassword });
}

// 冷启动靠原生 Cookie 静默恢复会话时(不走 login()),也要把 user 信息填回去——
// 之前以为后端没有"我是谁"接口,借用了未读数接口只验证会话有效但拿不到用户资料,
// 导致重启 App 后 Settings 页看不到昵称/邮箱。backend/Features/Auth/AuthController.cs
// 其实有 GET /api/auth/me,直接用这个,一次请求同时验证会话+拿到完整用户资料。
export function fetchMe() {
  return apiGet<AuthUser>("/api/auth/me");
}
