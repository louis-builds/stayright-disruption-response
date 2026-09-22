import { useEffect, useState } from "react";
import * as api from "./api";

// Tab 角标只需要两个数字，不需要 useInbox() 的完整卡片/标签数据——用独立的轻量轮询，
// 避免角标常驻(在 AppTabs 里)和 Inbox 页面同时挂载时重复拉一遍完整数据。
export function useInboxBadgeCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [inqRes, optRes] = await Promise.all([api.fetchInquiries("pending"), api.fetchSelectedOptions()]);
      if (cancelled) return;
      const inqCount = inqRes.code === 0 ? inqRes.data.length : 0;
      const optCount = optRes.code === 0 ? optRes.data.length : 0;
      setCount(inqCount + optCount);
    }
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return count;
}
