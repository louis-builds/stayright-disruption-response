import type { ApiResponse } from "./types";

export const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:5080";

// 401/403 时通知外层(导航层)跳回登录页——避免 client.ts 直接依赖导航库,
// 由 AuthContext 在启动时注册这个回调。
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

function checkUnauthorized<T>(status: number, body: ApiResponse<T>) {
  if (status === 401 || status === 403 || body.code === 401 || body.code === 403) {
    onUnauthorized?.();
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    // 原生网络层自动带上并持久化 Cookie(iOS NSHTTPCookieStorage / Android CookieManager),
    // 不需要手动管理 Cookie 头——credentials:"include" 让 RN 的 fetch 显式允许跨请求携带。
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await res.json()) as ApiResponse<T>;
  checkUnauthorized(res.status, body);
  return body;
}

// 退改政策文件上传是唯一的 multipart 接口(酒店图片/房型图片走 base64 data URL 直接进
// JSON body,不走这里——见 plan.md Task 5 的说明,后端本来就没有独立的图片上传接口)。
async function requestForm<T>(path: string, form: FormData): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const body = (await res.json()) as ApiResponse<T>;
  checkUnauthorized(res.status, body);
  return body;
}

export function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
  return request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
}

export function apiPut<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
  return request<T>(path, { method: "PUT", body: data === undefined ? undefined : JSON.stringify(data) });
}

export function apiDelete<T>(path: string): Promise<ApiResponse<T>> {
  return request<T>(path, { method: "DELETE" });
}

export function apiPostForm<T>(path: string, form: FormData): Promise<ApiResponse<T>> {
  return requestForm<T>(path, form);
}
