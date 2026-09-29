import { useState, type FormEvent, type ReactNode } from "react";
import { AvatarMenu } from "../../shared/components/AvatarMenu";
import { MTabBar } from "../../shared/components/MTabBar";
import { useMobileLayout } from "../../shared/layout/MobileLayoutProvider";
import { NotificationBell } from "../notifications";
import "../coordinator/CoordinatorDashboardShell.css";
import type { AdminTab } from "./types";

const ITEMS: Array<{ key: AdminTab; label: string; icon: string }> = [
  { key: "recordings", label: "Recording audit", icon: "☎" },
  { key: "users", label: "Users", icon: "▣" },
  { key: "kb", label: "Knowledge", icon: "▤" },
  { key: "bad_cases", label: "Bad cases", icon: "⚠" },
];

export function AdminDashboardShell({
  active,
  children,
  onNavigate,
  onSearch,
}: {
  active: AdminTab;
  children: ReactNode;
  onNavigate: (tab: AdminTab) => void;
  onSearch: (query: string) => void;
}) {
  const isMobile = useMobileLayout();
  const [query, setQuery] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(query.trim());
  };
  const currentSection = ITEMS.find((item) => item.key === active)?.label ?? "Admin";

  if (isMobile) {
    return (
      <div className="tg-shell tg-shell-m">
        <header className="tg-shell-m-top">
          <div>
            <small>StayRight NZ · Admin</small>
            <strong>{currentSection}</strong>
          </div>
          <div className="tg-shell-m-actions">
            <NotificationBell />
            <AvatarMenu />
          </div>
        </header>
        <main>{children}</main>
        <MTabBar
          items={ITEMS.map((item) => ({
            key: item.key,
            label: item.key === "recordings" ? "Audit" : item.key === "bad_cases" ? "Bad cases" : item.label,
            icon: item.icon,
            active: active === item.key,
            onClick: () => onNavigate(item.key),
          }))}
        />
      </div>
    );
  }

  return (
    <div className="tg-shell">
      <aside className="tg-shell-sidebar">
        <div className="tg-shell-brand">
          <span>◎</span>
          <div>
            <strong>StayRight NZ</strong>
            <small>ADMIN</small>
          </div>
        </div>
        <nav>
          {ITEMS.map((item) => (
            <button
              key={item.key}
              className={active === item.key ? "active" : ""}
              onClick={() => onNavigate(item.key)}
            >
              <i>{item.icon}</i>
              <em>{item.label}</em>
              <b>›</b>
            </button>
          ))}
        </nav>
        <div className="tg-shell-bottom">
          <button>
            <i>?</i>
            <em>Help</em>
          </button>
        </div>
      </aside>
      <div className="tg-shell-stage">
        <header className="tg-shell-topbar">
          <div className="tg-shell-context">
            <small>Admin workspace</small>
            <strong>{currentSection}</strong>
          </div>
          <form onSubmit={submit}>
            <i>⌕</i>
            <input
              value={query}
              onChange={(e) => {
                const next = e.target.value;
                setQuery(next);
                if (active === "recordings" && next === "") onSearch("");
              }}
              placeholder="Search guest, booking or coordinator…"
            />
          </form>
          <div className="tg-shell-actions">
            <NotificationBell />
            <span className="tg-shell-online">● Online</span>
            <AvatarMenu />
          </div>
        </header>
        <main>{children}</main>
        <footer>
          <span>AI travel support</span>
          <span>Help centre</span>
          <span>Privacy</span>
          <span>© StayRight NZ</span>
        </footer>
      </div>
    </div>
  );
}
