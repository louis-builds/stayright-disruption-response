import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AuthUser } from "../auth/types";
import type { CoordinatorTab } from "../../shared/components/CoordinatorTopNav";
import { AvatarMenu } from "../../shared/components/AvatarMenu";
import { MTabBar } from "../../shared/components/MTabBar";
import { useMobileLayout } from "../../shared/layout/MobileLayoutProvider";
import { NotificationBell } from "../notifications";
import { SettingsPanel } from "./SettingsPanel";
import "./CoordinatorDashboardShell.css";

type Section = "dashboard" | "cases" | "teams" | "reports";
const ITEMS: Array<{ key: Section; label: string; icon: string; tab: CoordinatorTab; hidden?: boolean }> = [
  { key: "dashboard", label: "Dashboard", icon: "▦", tab: "overview" },
  { key: "cases", label: "Disruptions", icon: "△", tab: "disruptions" },
  { key: "teams", label: "Affected Bookings", icon: "▣", tab: "queue", hidden: true },
  { key: "reports", label: "Cases", icon: "▥", tab: "search" },
];

export function CoordinatorDashboardShell({ active, children, onNavigate, onSearch }: {
  user: AuthUser; active: Section; children: ReactNode; onNavigate: (tab: CoordinatorTab) => void; onSearch: (query: string) => void;
}) {
  const isMobile = useMobileLayout();
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); onSearch(query.trim()); };
  const currentSection = ITEMS.find((item) => item.key === active)?.label ?? "Workspace";
  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSettingsOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  const settingsDialog = settingsOpen && (
    <div className="tg-settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section className="tg-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="tg-settings-title">
        <header><div><small>COORDINATOR SETTINGS</small><h2 id="tg-settings-title">Automation preferences</h2><p>Control when AI-managed cases are handed to a coordinator.</p></div><button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>×</button></header>
        <div className="tg-settings-content"><SettingsPanel /></div>
      </section>
    </div>
  );

  if (isMobile) {
    return (
      <div className="tg-shell tg-shell-m">
        <header className="tg-shell-m-top">
          <div>
            <small>StayRight NZ · Coordinator</small>
            <strong>{currentSection}</strong>
          </div>
          <div className="tg-shell-m-actions">
            <NotificationBell />
            <AvatarMenu />
          </div>
        </header>
        <main>{children}</main>
        <MTabBar
          items={[
            ...ITEMS.filter((item) => !item.hidden).map((item) => ({
              key: item.key,
              label: item.label,
              icon: item.icon,
              active: active === item.key && !settingsOpen,
              onClick: () => onNavigate(item.tab),
            })),
            { key: "settings", label: "Settings", icon: "⚙", active: settingsOpen, onClick: () => setSettingsOpen(true) },
          ]}
        />
        {settingsDialog}
      </div>
    );
  }

  return <div className="tg-shell">
    <aside className="tg-shell-sidebar">
      <div className="tg-shell-brand"><span>◎</span><div><strong>StayRight NZ</strong><small>COORDINATOR</small></div></div>
      <nav>{ITEMS.filter((item) => !item.hidden).map((item) => <button key={item.key} className={active === item.key ? "active" : ""} onClick={() => onNavigate(item.tab)}><i>{item.icon}</i><em>{item.label}</em><b>›</b></button>)}</nav>
      <div className="tg-shell-bottom"><button onClick={() => setSettingsOpen(true)}><i>⚙</i><em>Settings</em></button><button><i>?</i><em>Help</em></button></div>
    </aside>
    <div className="tg-shell-stage">
      <header className="tg-shell-topbar"><div className="tg-shell-context"><small>Coordinator workspace</small><strong>{currentSection}</strong></div><form onSubmit={submit}><i>⌕</i><input value={query} onChange={(e) => { const next = e.target.value; setQuery(next); if (active === "reports" && next === "") onSearch(""); }} placeholder="Search booking, guest or case…" /></form><div className="tg-shell-actions"><NotificationBell/><span className="tg-shell-online">● Online</span><AvatarMenu/></div></header>
      <main>{children}</main>
      <footer><span>AI Agent</span><span>Legal</span><span>Privacy</span><span>© TravelGuard</span></footer>
    </div>
    {settingsDialog}
  </div>;
}
