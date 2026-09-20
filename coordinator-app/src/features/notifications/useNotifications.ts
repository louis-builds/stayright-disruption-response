import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import type { NotificationItem } from "./types";

const POLL_INTERVAL_MS = 20_000;

export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const [listRes, countRes] = await Promise.all([
        api.fetchNotifications(1, 30, unreadOnly),
        api.fetchUnreadCount(),
      ]);
      if (listRes.code === 0) setItems(listRes.data.list);
      if (countRes.code === 0) setUnreadCount(countRes.data.count);
      setLoading(false);
    },
    [unreadOnly],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const markRead = useCallback(
    async (id: string) => {
      await api.markNotificationRead(id);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    },
    [],
  );

  return { items, unreadOnly, setUnreadOnly, unreadCount, loading, refreshing, refresh, markRead };
}
