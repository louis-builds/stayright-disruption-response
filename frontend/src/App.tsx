import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, ProtectedRoute, useAuth } from "./features/auth";
import { LoginRoute, RegisterRoute } from "./features/auth/AuthLayoutRoutes";
import { GuestHomePage } from "./features/home/GuestHomePage";
import { ProfilePage } from "./features/profile";
import { CaseActionConfirmPage, CaseConversationPage, OptionsFlowPage } from "./features/cases";
import { MyBookingsPage } from "./features/bookings";
import { CoordinatorHomePage, EscalationDeskPage, OptionsAdminPage, CallReviewsPage } from "./features/coordinator";
import { HotelHomePage } from "./features/hotel";
import { AdminHomePage } from "./features/admin";
import { LandingPage } from "./features/landing/LandingPage";
import { MobileLayoutProvider, useMobileLayout } from "./shared/layout/MobileLayoutProvider";

function RootRedirect() {
  const { user, loading } = useAuth();
  const isMobile = useMobileLayout();
  if (loading) return null;
  return <Navigate to={user ? user.homeRoute : isMobile ? "/m/login" : "/login"} replace />;
}

function HomeRoute() {
  const isMobile = useMobileLayout();
  if (isMobile) return <RootRedirect />;
  return <LandingPage />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <MobileLayoutProvider>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/app" element={<RootRedirect />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/m/login" element={<LoginRoute />} />
          <Route path="/register" element={<RegisterRoute />} />
          <Route path="/m/register" element={<RegisterRoute />} />
          <Route path="/case-actions/confirm" element={<CaseActionConfirmPage />} />
          <Route
            path="/guest/home"
            element={
              <ProtectedRoute roles={["guest"]}>
                <GuestHomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coordinator/home"
            element={
              <ProtectedRoute roles={["coordinator"]}>
                <CoordinatorHomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hotel/home"
            element={
              <ProtectedRoute roles={["hotel"]}>
                <HotelHomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/home"
            element={
              <ProtectedRoute roles={["admin"]}>
                <AdminHomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coordinator/call-reviews"
            element={
              <ProtectedRoute roles={["coordinator"]}>
                <CallReviewsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cases/:id"
            element={
              <ProtectedRoute>
                <CaseConversationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/cases/:id/options"
            element={
              <ProtectedRoute roles={["guest"]}>
                <OptionsFlowPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coordinator/cases/:id/options"
            element={
              <ProtectedRoute roles={["coordinator"]}>
                <OptionsAdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/coordinator/cases/:id/escalation"
            element={
              <ProtectedRoute roles={["coordinator"]}>
                <EscalationDeskPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bookings"
            element={
              <ProtectedRoute roles={["guest"]}>
                <MyBookingsPage />
              </ProtectedRoute>
            }
          />
        </Routes>
        </MobileLayoutProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
