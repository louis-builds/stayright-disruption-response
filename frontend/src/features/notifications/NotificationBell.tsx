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
  const navigate = useNavigate();
  const ref = useClickOutside(() => setOpen(false));

  // 只留未读的：已读的立刻从下拉里消失，不然通知会越积越多，永远都在列表里。
  const unreadItems = items.filter((n) => !n.readAt);

  async function handleItemClick(id: string, caseId: string | null, type: string) {
    await markRead(id);
    setOpen(false);
    // /cases/:id 是客人视角的对话页，酒店角色不是这个线程的参与者——点进去只会看到空对话框。
    // 酒店的通知只是提醒去"My to-dos"处理，点开就该只标记已读，不用跳一个没内容的页面。
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
            <button
              key={n.id}
              className="bell-item bell-item-unread"
              title={`${n.title}\n${n.body}`}
              onClick={() => void handleItemClick(n.id, n.caseId, n.type)}
            >
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
