import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { NotificationItem } from "./types";

// Web 端 frontend/src/features/notifications/useNotifications.ts 就是 20 秒轮询一次，
// 这里对齐同一个数字，不凭感觉另定一个。
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

  // load() 的身份随 unreadOnly 变化而变化——effect 因此不止在挂载时跑一次，切换
  // "Unread only" 开关也会重新触发它。挂载首次允许非 silent(有 showLoading 的
  // 0.2 秒 floor 兜底，不会闪屏)，但开关切换这次如果也非 silent，会在 floor 已经
  // 过去之后让整屏直接换成满屏 spinner，把用户刚点的 Switch 本身都盖掉——所以除了
  // 挂载那一次，其余都走 silent，跟下拉刷新/轮询同一个约定。
  const isFirstLoad = useRef(true);
  useEffect(() => {
    void load({ silent: !isFirstLoad.current });
    isFirstLoad.current = false;
    const timer = setInterval(() => void load({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // 跟 useInbox/useHistory 同一个坑：下拉刷新不传 silent 的话会把 loading 拉回 true，
  // 整屏被 showLoading 换成满屏 spinner，FlatList 自己的 RefreshControl 转圈反而被盖掉，
  // 挂载动画也会被误当成重新进页面重播一次。
  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    setRefreshing(true);
    await load(opts);
    setRefreshing(false);
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    await api.markNotificationRead(id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  // 后端没有专门的"全部标记已读"接口，复用现有单条接口逐条调用——量级是一屏通知，
  // 不值得为这个新开一个批量端点。
  const [markingAll, setMarkingAll] = useState(false);
  const markAllRead = useCallback(async () => {
    setMarkingAll(true);
    const unreadIds = items.filter((n) => n.readAt === null).map((n) => n.id);
    try {
      // allSettled 而不是 all：某一条标记失败不该连累其它条也不落地，也不该让
      // finally 之前就整个函数抛出去，那样 markingAll 会卡在 true 出不来。
      await Promise.allSettled(unreadIds.map((id) => api.markNotificationRead(id)));
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => (unreadIds.includes(n.id) ? { ...n, readAt: now } : n)));
      // 减去这一批标记的数量而不是硬置0：轮询/刷新可能在这中间插入了新的未读，
      // 那部分不该被这次操作误清零。
      setUnreadCount((c) => Math.max(0, c - unreadIds.length));
    } finally {
      setMarkingAll(false);
    }
  }, [items]);

  return { items, unreadOnly, setUnreadOnly, unreadCount, loading, refreshing, refresh, markRead, markAllRead, markingAll };
}
