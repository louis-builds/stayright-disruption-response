import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import type { NotificationItem } from "./types";

const POLL_INTERVAL_MS = 20_000;

/** 铃铛通知的状态/逻辑层：轮询未读数与列表，不需要用户手动刷新页面就能看到新通知。 */
export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    // 铃铛下拉菜单只关心未读——按发送时间排的默认列表只取最新10条，账号用久了未读的可能
    // 排在10条以外，会导致铃铛角标显示数字但下拉列表却是空的、点了也没反应。
    const [listRes, countRes] = await Promise.all([api.fetchNotifications(1, 10, true), api.fetchUnreadCount()]);
    if (listRes.code === 0) setItems(listRes.data.list);
    if (countRes.code === 0) setUnreadCount(countRes.data.count);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const markRead = useCallback(
    async (id: string) => {
      await api.markNotificationRead(id);
      await refresh();
    },
    [refresh],
  );

  return { items, unreadCount, markRead, refresh };
}
