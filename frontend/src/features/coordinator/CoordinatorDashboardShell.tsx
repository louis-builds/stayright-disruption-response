import { useState, type FormEvent, type ReactNode } from "react";
import type { AuthUser } from "../auth/types";
import type { CoordinatorTab } from "../../shared/components/CoordinatorTopNav";
import { AvatarMenu } from "../../shared/components/AvatarMenu";
import { NotificationBell } from "../notifications";
import "./CoordinatorDashboardShell.css";

type Section = "dashboard" | "cases" | "teams" | "reports";
const ITEMS: Array<{ key: Section; label: string; icon: string; tab: CoordinatorTab }> = [
  { key: "dashboard", label: "Dashboard", icon: "▦", tab: "overview" },
  { key: "cases", label: "Disruptions", icon: "△", tab: "disruptions" },
  { key: "teams", label: "Affected Bookings", icon: "▣", tab: "queue" },
  { key: "reports", label: "Cases", icon: "▥", tab: "search" },
];

export function CoordinatorDashboardShell({ active, children, onNavigate, onSearch }: {
  user: AuthUser; active: Section; children: ReactNode; onNavigate: (tab: CoordinatorTab) => void; onSearch: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent) => { event.preventDefault(); if (query.trim()) onSearch(query.trim()); };
  const currentSection = ITEMS.find((item) => item.key === active)?.label ?? "Workspace";
  return <div className="tg-shell">
    <aside className="tg-shell-sidebar">
      <div className="tg-shell-brand"><span>◎</span><div><strong>StayRight NZ</strong><small>COORDINATOR</small></div></div>
      <nav>{ITEMS.map((item) => <button key={item.key} className={active === item.key ? "active" : ""} onClick={() => onNavigate(item.tab)}><i>{item.icon}</i><em>{item.label}</em><b>›</b></button>)}</nav>
      <div className="tg-shell-bottom"><button onClick={() => onNavigate("settings")}><i>⚙</i><em>Settings</em></button><button><i>?</i><em>Help</em></button></div>
    </aside>
    <div className="tg-shell-stage">
      <header className="tg-shell-topbar"><div className="tg-shell-context"><small>Coordinator workspace</small><strong>{currentSection}</strong></div><form onSubmit={submit}><i>⌕</i><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search booking, guest or case…" /></form><div className="tg-shell-actions"><NotificationBell/><span className="tg-shell-online">● Online</span><AvatarMenu/></div></header>
      <main>{children}</main>
      <footer><span>AI Agent</span><span>Legal</span><span>Privacy</span><span>© TravelGuard</span></footer>
    </div>
  </div>;
}
