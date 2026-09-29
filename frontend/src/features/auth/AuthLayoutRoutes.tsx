import { Navigate, useLocation } from "react-router-dom";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { MobileLoginPage } from "../../m/auth/MobileLoginPage";
import { useMobileLayout } from "../../shared/layout/MobileLayoutProvider";

export function LoginRoute() {
  const isMobile = useMobileLayout();
  const location = useLocation();
  if (isMobile && location.pathname !== "/m/login") {
    return <Navigate to="/m/login" state={location.state} replace />;
  }
  if (!isMobile && location.pathname === "/m/login") {
    return <Navigate to="/login" state={location.state} replace />;
  }
  return isMobile ? <MobileLoginPage /> : <LoginPage />;
}

export function RegisterRoute() {
  const isMobile = useMobileLayout();
  const location = useLocation();
  if (isMobile && location.pathname !== "/m/register") {
    return <Navigate to="/m/register" state={location.state} replace />;
  }
  if (!isMobile && location.pathname === "/m/register") {
    return <Navigate to="/register" state={location.state} replace />;
  }
  return <RegisterPage />;
}
