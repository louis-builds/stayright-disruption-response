import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useNotifications } from "./useNotifications";
import "./NotificationBell.css";

function useClickOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

export function NotificationBell() {
  const { user } = useAuth();
  const { items, unreadCount, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"all" | "unread">("all");
  const navigate = useNavigate();
  const ref = useClickOutside(() => setOpen(false));

  const unreadItems = items.filter((n) => !n.readAt);
  const visibleItems = view === "unread" ? unreadItems : items;

  async function handleItemClick(id: string, caseId: string | null, type: string) {
    await markRead(id);
    setOpen(false);
    // /cases/:id 是客人视角的对话页，酒店角色不是这个线程的参与者——点进去只会看到空对话框。
    // 酒店的通知只是提醒去"My to-dos"处理，点开就该只标记已读，不用跳一个没内容的页面。
    if (user?.role === "coordinator" && type === "call_audit") {
      navigate("/coordinator/call-reviews");
      return;
    }
    if (!caseId || user?.role === "hotel") return;
    if (user?.role === "coordinator" && type === "refund_pending") {
      navigate(`/coordinator/cases/${caseId}/escalation`);
      return;
    }
    navigate(`/cases/${caseId}`);
  }

  return (
    <div className="bell" ref={ref}>
      <button
        className="bell-trigger"
        disabled={items.length === 0}
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        🔔
        {unreadCount > 0 && <span className="bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && items.length > 0 && (
        <div className="bell-dropdown">
          <header className="bell-dropdown-header">
            <strong>Notifications</strong>
            <div className="bell-tabs" role="tablist" aria-label="Notification filters">
              <button type="button" role="tab" aria-selected={view === "all"} className={view === "all" ? "active" : ""} onClick={() => setView("all")}>All</button>
              <button type="button" role="tab" aria-selected={view === "unread"} className={view === "unread" ? "active" : ""} onClick={() => setView("unread")}>Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}</button>
            </div>
          </header>
          {visibleItems.length === 0 ? (
            <p className="bell-empty">No unread notifications.</p>
          ) : (
            visibleItems.map((n) => (
              <button
                key={n.id}
                className={`bell-item${n.readAt ? "" : " bell-item-unread"}`}
                title={`${n.title}\n${n.body}`}
                onClick={() => void handleItemClick(n.id, n.caseId, n.type)}
              >
                <span className="bell-item-title">{n.title}</span>
                <span className="bell-item-body">{n.body}</span>
                <span className="bell-item-time">{new Date(n.sentAt).toLocaleString()}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
