import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setUnauthorizedHandler } from "../../shared/api/client";
import * as api from "./api";
import type { AuthUser, RegisterRequest } from "./types";

const REMEMBERED_IDENTIFIER_KEY = "guest-app:rememberedIdentifier";
const WAS_LOGGED_IN_KEY = "guest-app:wasLoggedIn";
export const EXPO_PUSH_TOKEN_KEY = "guest-app:expoPushToken";

type AuthStatus = "checking" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  rememberedIdentifier: string | null;
  login: (identifier: string, password: string, rememberMe: boolean) => Promise<{ ok: true } | { ok: false; message: string }>;
  register: (request: RegisterRequest) => Promise<{ ok: true } | { ok: false; message: string }>;
  logout: () => Promise<void>;
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [rememberedIdentifier, setRememberedIdentifier] = useState<string | null>(null);

  const clearLocalSession = useCallback(async () => {
    setUser(null);
    setStatus("unauthenticated");
    await AsyncStorage.removeItem(WAS_LOGGED_IN_KEY);
  }, []);

  // 会话在使用过程中失效(比如后端 session 过期)时,client.ts 会调这个回调,
  // 而不是每个页面各自处理 401/403。
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearLocalSession();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearLocalSession]);

  // 启动时先读本地"大概率已登录"标记决定要不要打一个真实请求去确认——
  // 真正的鉴权状态永远以这次请求的成败为准,标记只是用来这一步别让用户先看到登录页再跳走。
  useEffect(() => {
    (async () => {
      const [remembered, wasLoggedIn] = await Promise.all([
        AsyncStorage.getItem(REMEMBERED_IDENTIFIER_KEY),
        AsyncStorage.getItem(WAS_LOGGED_IN_KEY),
      ]);
      setRememberedIdentifier(remembered);

      if (wasLoggedIn !== "true") {
        setStatus("unauthenticated");
        return;
      }

      const res = await api.fetchMe();
      if (res.code === 0) {
        setUser(res.data);
        setStatus("authenticated");
      } else {
        setStatus("unauthenticated");
      }
    })();
  }, []);

  const login = useCallback(async (identifier: string, password: string, rememberMe: boolean) => {
    const res = await api.login({ identifier, password, rememberMe });
    if (res.code !== 0) {
      return { ok: false as const, message: res.message || "Login failed" };
    }

    if (res.data.role !== "guest") {
      await api.logout();
      return { ok: false as const, message: "This app is for travellers only" };
    }

    setUser(res.data);
    setStatus("authenticated");
    await AsyncStorage.setItem(WAS_LOGGED_IN_KEY, "true");
    if (rememberMe) {
      await AsyncStorage.setItem(REMEMBERED_IDENTIFIER_KEY, identifier);
      setRememberedIdentifier(identifier);
    } else {
      await AsyncStorage.removeItem(REMEMBERED_IDENTIFIER_KEY);
      setRememberedIdentifier(null);
    }
    return { ok: true as const };
  }, []);

  // POST /api/auth/register 只建账号,不像 /api/auth/login 那样顺带 SignInAsync 种 Cookie——
  // 后端这两个接口的鉴权行为不对称,注册成功后必须再补一次真实登录才算真正进入已登录态,
  // 不能想当然地把注册成功直接当成登录成功处理。
  const register = useCallback(
    async (request: RegisterRequest) => {
      const res = await api.register(request);
      if (res.code !== 0) {
        return { ok: false as const, message: res.message || "Registration failed" };
      }
      return login(request.email, request.password, false);
    },
    [login],
  );

  // 登出前先注销这台设备的 push token,不然后端还会往一个已经登出的设备推送——
  // 静默失败即可(token 可能本来就没注册成功过,比如 web 或权限被拒绝的场景)。
  const logout = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem(EXPO_PUSH_TOKEN_KEY);
      if (token) {
        try {
          await api.unregisterPushToken(token);
        } catch {
          // 静默失败:网络问题不应该阻止用户登出。
        }
        await AsyncStorage.removeItem(EXPO_PUSH_TOKEN_KEY);
      }
      await api.logout();
    } finally {
      await clearLocalSession();
    }
  }, [clearLocalSession]);

  const updateUser = useCallback((next: AuthUser) => {
    setUser(next);
  }, []);

  const value = useMemo(
    () => ({ status, user, rememberedIdentifier, login, register, logout, updateUser }),
    [status, user, rememberedIdentifier, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
