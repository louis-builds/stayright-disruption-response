import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { ApiResponse } from "./types";

const SERVER_URL_OVERRIDE_KEY = "guest-app:serverUrlOverride";
let overrideBaseUrl: string | null = null;

// App.tsx 在挂载 AuthProvider 之前 await 这个,保证 AuthContext 挂载时发的第一个请求
// (checking 会话状态)就已经用上了引导页里配置的地址,不用等这次请求失败了才生效。
export async function loadServerUrlOverride(): Promise<void> {
  try {
    overrideBaseUrl = await AsyncStorage.getItem(SERVER_URL_OVERRIDE_KEY);
  } catch {
    overrideBaseUrl = null;
  }
}

export async function setServerUrlOverride(url: string | null): Promise<void> {
  overrideBaseUrl = url && url.trim() ? url.trim().replace(/\/$/, "") : null;
  try {
    if (overrideBaseUrl) await AsyncStorage.setItem(SERVER_URL_OVERRIDE_KEY, overrideBaseUrl);
    else await AsyncStorage.removeItem(SERVER_URL_OVERRIDE_KEY);
  } catch {
    // 存不进 AsyncStorage 就只在内存里生效,这次会话还是能用,不阻断配置本身。
  }
}

export function getServerUrlOverride(): string | null {
  return overrideBaseUrl;
}

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
  if (overrideBaseUrl) return overrideBaseUrl;
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

// 引导页配置服务器地址后不重启App就要生效,不能再用挂载时算一次就冻结的常量——
// 每次请求都重新算,取的是当时的 overrideBaseUrl。
export function getBaseUrl(): string {
  return resolveBaseUrl();
}

// 401/403 时通知外层(导航层)跳回登录页——避免 client.ts 直接依赖导航库,
// 由 AuthContext 在启动时注册这个回调。
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const baseUrl = getBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      // 原生网络层自动带上并持久化 Cookie(iOS NSHTTPCookieStorage / Android CookieManager),
      // 不需要手动管理 Cookie 头——credentials:"include" 让 RN 的 fetch 显式允许跨请求携带。
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    return { code: 503, message: `Cannot reach API at ${baseUrl}`, data: null as T };
  }

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
