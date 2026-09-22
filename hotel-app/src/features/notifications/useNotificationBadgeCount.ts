import { useEffect, useState } from "react";
import * as api from "./api";

// 跟 features/inbox/useInboxBadgeCount.ts 同一个理由：Tab 角标常驻在 AppTabs 里，
// 不依赖 Notifications 页面是否挂载，用独立的轻量轮询，不跟 useNotifications() 抢一份状态。
const POLL_INTERVAL_MS = 20_000;

export function useNotificationBadgeCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await api.fetchUnreadCount();
      if (!cancelled && res.code === 0) setCount(res.data.count);
    }
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return count;
}
