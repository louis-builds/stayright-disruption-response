import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as authApi from "./api";
import { RETURN_URL_KEY } from "../../shared/api/client";
import type { AuthUser, LoginPayload, RegisterPayload } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (payload: LoginPayload) => Promise<AuthUser>;
  register: (payload: RegisterPayload) => Promise<AuthUser>;
  logout: () => Promise<void>;
  /** Profile/Email 修改成功后用最新数据同步 store，导航栏头像/昵称立刻生效，不用刷新页面。 */
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authApi
      .fetchMe()
      .then((res) => setUser(res.code === 0 ? res.data : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const res = await authApi.login(payload);
    if (res.code !== 0) throw new Error(res.message);
    setUser(res.data);
    return res.data;
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const res = await authApi.register(payload);
    if (res.code !== 0) throw new Error(res.message);
    return res.data;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    // 换账号时把"登录前想去的页面"清掉，不然下一个账号(可能完全不同角色)登录会被带去
    // 上一个账号残留的目标页，ProtectedRoute 的角色校验会把人弹回去，但干脆不留隐患更省心。
    sessionStorage.removeItem(RETURN_URL_KEY);
  }, []);

  const updateUser = useCallback((next: AuthUser) => setUser(next), []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
