import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useMobileLayout } from "../../shared/layout/MobileLayoutProvider";

export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const isMobile = useMobileLayout();
  const signInPath = isMobile ? "/m/login" : "/login";

  if (loading) return null;
  if (!user) return <Navigate to={signInPath} state={{ from: location.pathname }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={user.homeRoute} replace />;
  if (user.mustChangePassword && location.pathname !== "/profile") return <Navigate to="/profile" replace />;
  return <>{children}</>;
}
