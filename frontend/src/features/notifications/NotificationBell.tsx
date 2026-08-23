import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const { items, unreadCount, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useClickOutside(() => setOpen(false));

  // 只留未读的：已读的立刻从下拉里消失，不然通知会越积越多，永远都在列表里。
  const unreadItems = items.filter((n) => !n.readAt);

  async function handleItemClick(id: string, caseId: string | null) {
    await markRead(id);
    setOpen(false);
    if (caseId) navigate(`/cases/${caseId}`);
  }

  return (
    <div className="bell" ref={ref}>
      <button
        className="bell-trigger"
        disabled={unreadItems.length === 0}
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
      >
        🔔
        {unreadCount > 0 && <span className="bell-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {open && unreadItems.length > 0 && (
        <div className="bell-dropdown">
          {unreadItems.map((n) => (
            <button key={n.id} className="bell-item bell-item-unread" onClick={() => void handleItemClick(n.id, n.caseId)}>
              <span className="bell-item-title">{n.title}</span>
              <span className="bell-item-body">{n.body}</span>
              <span className="bell-item-time">{new Date(n.sentAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
