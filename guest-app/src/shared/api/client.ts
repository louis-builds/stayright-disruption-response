import Constants from "expo-constants";
import { Platform } from "react-native";
import type { ApiResponse } from "./types";

function lanHostFromExpo(): string | null {
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.linkingUri,
    Constants.experienceUrl,
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    const ip = raw.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    if (ip) return ip[1];
    try {
      const host = new URL(raw.includes("://") ? raw : `http://${raw}`).hostname;
      if (host && host !== "localhost" && host !== "127.0.0.1") return host;
    } catch {
      /* ignore unparseable Expo URLs */
    }
  }
  return null;
}

function resolveBaseUrl() {
  const extra = typeof Constants.expoConfig?.extra?.apiBaseUrl === "string"
    ? Constants.expoConfig.extra.apiBaseUrl
    : undefined;
  const explicit = (process.env.EXPO_PUBLIC_API_BASE_URL ?? extra ?? "http://localhost:5080").replace(/\/$/, "");
  if (Platform.OS === "web") return explicit;
  if (!/localhost|127\.0\.0\.1/.test(explicit)) return explicit;
  const lan = lanHostFromExpo();
  if (!lan) return explicit;
  const port = explicit.match(/:(\d+)$/)?.[1] ?? "5080";
  return `http://${lan}:${port}`;
}

export const BASE_URL = resolveBaseUrl();

// 401/403 时通知外层(导航层)跳回登录页——避免 client.ts 直接依赖导航库,
// 由 AuthContext 在启动时注册这个回调。
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
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

  if (res.status === 401 || res.status === 403 || body.code === 401 || body.code === 403) {
    onUnauthorized?.();
  }

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

export function apiDelete<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
  return request<T>(path, { method: "DELETE", body: data === undefined ? undefined : JSON.stringify(data) });
}
