// 服务层基座：所有模块的 api.ts 都通过这个 client 发请求，视图层不得直接调用它。
import { isAuthPath, loginPath } from "../layout/mobileLayout";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5080";
export const API_BASE = API_BASE_URL;
export const RETURN_URL_KEY = "td_return_url";

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

interface ApiOptions extends RequestInit {
  /** /me 这类"探测是否登录"的调用不应该在收到 401 时把用户弹去登录页。 */
  skipAuthRedirect?: boolean;
}

// 后端 Program.cs 的 Cookie 认证明确分了两种情况：真的没登录/会话过期是 401
// （OnRedirectToLogin），登录了但这个角色/资源没权限是 403（OnRedirectToAccessDenied，或者
// controller 里手动 catch 权限异常返回的 403）。之前这里错拿 403 当"没登录"处理——协调员访问一个
// 只对 guest 开放的接口，明明登录着，会被强制跳去 /login；AuthContext 的 user 其实还在，
// LoginPage 见到 user 非空就 <Navigate to={from} replace /> 把人弹回刚才那个页面，页面一加载又
// 触发同一个 403，再跳 /login，再弹回来——死循环。真正该在 401 时跳（会话确实失效了，跳登录页
//   才有意义），403 直接让调用方自己的 try/catch/error 状态处理就行，不该碰导航。
function handle401(res: Response, skipAuthRedirect?: boolean) {
  if (res.status !== 401 || skipAuthRedirect) return;
  if (isAuthPath(window.location.pathname)) return;
  sessionStorage.setItem(RETURN_URL_KEY, window.location.pathname);
  window.location.href = loginPath();
}

export async function apiGet<T>(path: string, options?: ApiOptions): Promise<ApiResponse<T>> {
  const { skipAuthRedirect, ...init } = options ?? {};
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, credentials: "include" });
  handle401(res, skipAuthRedirect);
  return res.json() as Promise<ApiResponse<T>>;
}

export async function apiPost<T>(path: string, body: unknown, options?: ApiOptions): Promise<ApiResponse<T>> {
  const { skipAuthRedirect, ...init } = options ?? {};
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: JSON.stringify(body),
  });
  handle401(res, skipAuthRedirect);
  return res.json() as Promise<ApiResponse<T>>;
}

export async function apiPut<T>(path: string, body: unknown, options?: ApiOptions): Promise<ApiResponse<T>> {
  const { skipAuthRedirect, ...init } = options ?? {};
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
    body: JSON.stringify(body),
  });
  handle401(res, skipAuthRedirect);
  return res.json() as Promise<ApiResponse<T>>;
}

export async function apiDelete<T>(path: string, options?: ApiOptions): Promise<ApiResponse<T>> {
  const { skipAuthRedirect, ...init } = options ?? {};
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, method: "DELETE", credentials: "include" });
  handle401(res, skipAuthRedirect);
  return res.json() as Promise<ApiResponse<T>>;
}

export async function apiPostMultipart<T>(path: string, formData: FormData, options?: ApiOptions): Promise<ApiResponse<T>> {
  const { skipAuthRedirect, ...init } = options ?? {};
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    method: "POST",
    credentials: "include",
    body: formData,
  });
  handle401(res, skipAuthRedirect);
  return res.json() as Promise<ApiResponse<T>>;
}
