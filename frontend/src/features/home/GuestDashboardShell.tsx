import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AvatarMenu } from "../../shared/components/AvatarMenu";
import { MTabBar } from "../../shared/components/MTabBar";
import { useMobileLayout } from "../../shared/layout/MobileLayoutProvider";
import { NotificationBell } from "../notifications";
import "./GuestDashboardShell.css";

type GuestSection = "dashboard" | "bookings" | "profile";

export function GuestDashboardShell({ children, active = "dashboard", onSearch }: { children: ReactNode; active?: GuestSection; onSearch?: (query: string) => void }) {
  const navigate = useNavigate();
  const isMobile = useMobileLayout();
  const [query, setQuery] = useState("");
  const sectionTitle = active === "bookings" ? "My Bookings" : active === "profile" ? "Profile Settings" : "Dashboard";

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch?.(query.trim());
  }

  if (isMobile) {
    return (
      <div className="guest-shell guest-shell-m">
        <header className="guest-shell-m-top">
          <div>
            <small>StayRight NZ</small>
            <strong>{sectionTitle}</strong>
          </div>
          <div className="guest-shell-m-actions">
            <NotificationBell />
            <AvatarMenu />
          </div>
        </header>
        <main>{children}</main>
        <MTabBar
          items={[
            { key: "dashboard", label: "Dashboard", icon: "▦", active: active === "dashboard", onClick: () => navigate("/guest/home") },
            { key: "bookings", label: "Bookings", icon: "▣", active: active === "bookings", onClick: () => navigate("/bookings") },
            { key: "profile", label: "Profile", icon: "⚙", active: active === "profile", onClick: () => navigate("/profile") },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="guest-shell">
      <aside className="guest-shell-sidebar">
        <button className="guest-shell-brand" type="button" onClick={() => navigate("/guest/home")}>
          <span aria-hidden="true">◎</span>
          <div><strong>StayRight NZ</strong><small>TRAVELLER</small></div>
        </button>
        <nav aria-label="Guest navigation">
          <button type="button" className={active === "dashboard" ? "active" : ""} onClick={() => navigate("/guest/home")}>
            <i aria-hidden="true">▦</i><em>Dashboard</em><b>›</b>
          </button>
          <button type="button" className={active === "bookings" ? "active" : ""} onClick={() => navigate("/bookings")}>
            <i aria-hidden="true">▣</i><em>My Bookings</em><b>›</b>
          </button>
        </nav>
        <div className="guest-shell-bottom">
          <button type="button" className={active === "profile" ? "active" : ""} onClick={() => navigate("/profile")}><i aria-hidden="true">⚙</i><em>Profile settings</em></button>
          <button type="button"><i aria-hidden="true">?</i><em>Help</em></button>
        </div>
      </aside>

      <div className="guest-shell-stage">
        <header className="guest-shell-topbar">
          <div className="guest-shell-context"><small>Traveller workspace</small><strong>{sectionTitle}</strong></div>
          <form onSubmit={submit}>
            <i aria-hidden="true">⌕</i>
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); onSearch?.(event.target.value); }} placeholder={active === "bookings" ? "Search bookings, hotels or status..." : "Search notices, hotels or disruptions..."} aria-label="Search guest workspace" />
          </form>
          <div className="guest-shell-actions"><NotificationBell /><span>● Online</span><AvatarMenu /></div>
        </header>
        <main>{children}</main>
        <footer><span>AI travel support</span><span>Help centre</span><span>Privacy</span><span>© StayRight NZ</span></footer>
      </div>
    </div>
  );
}
