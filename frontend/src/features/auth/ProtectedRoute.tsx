import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** 未登录跳转登录页并记住来源路径，Task 5 的登录成功跳转会读取这个 state.from。
 * roles: 限定这条路由只有哪些角色能看——不传就是"登录了就行"(profile/cases 这类三端共用页)。
 * 角色对不上时跳去这个用户自己的 homeRoute，而不是放行渲染错角色的页面：
 * 之前真实出过的 bug——sessionStorage 里存的 "登录前想去的页面" 跨账号残留(比如上一个协调员
 * 账号 403 时记下 /coordinator/home，下一个用完全不同权限的客人账号登录，登录页读到这条脏数据
 * 直接把客人导去协调员主页)，页面里全是协调员专属接口，客人权限下逐个 403，
 * 每个 403 都会触发 client.ts 的硬跳转回登录页，看起来就是"登录后直接又弹回登录页"。 */
export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={user.homeRoute} replace />;
  if (user.mustChangePassword && location.pathname !== "/profile") return <Navigate to="/profile" replace />;
  return <>{children}</>;
}
