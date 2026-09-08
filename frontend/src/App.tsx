import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, LoginPage, ProtectedRoute, RegisterPage, useAuth } from "./features/auth";
import { GuestHomePage } from "./features/home/GuestHomePage";
import { ProfilePage } from "./features/profile";
import { CaseActionConfirmPage, CaseConversationPage, OptionsFlowPage } from "./features/cases";
import { MyBookingsPage } from "./features/bookings";
import { CoordinatorHomePage, EscalationDeskPage, OptionsAdminPage } from "./features/coordinator";
import { HotelHomePage } from "./features/hotel";
import { LandingPage } from "./features/landing/LandingPage";

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? user.homeRoute : "/login"} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/app" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
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
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
