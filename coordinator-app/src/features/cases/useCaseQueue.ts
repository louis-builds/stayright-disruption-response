import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { CaseQueueItem, CaseQueueTab } from "./types";

const POLL_INTERVAL_MS = 20_000;

function fetchForTab(tab: CaseQueueTab, searchText: string) {
  switch (tab) {
    case "queue":
      return api.fetchQueue();
    case "todo":
      return api.fetchMine("pending");
    case "in_progress":
      return api.fetchMine("in_progress");
    case "closed":
      return api.fetchClosed(7);
    case "search":
      return api.search(searchText);
  }
}

export function useCaseQueue() {
  const [tab, setTab] = useState<CaseQueueTab>("queue");
  const [searchText, setSearchText] = useState("");
  const [items, setItems] = useState<CaseQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);

  // 只用来算"待处理"这个 Tab 的新案件角标——不是给别的 Tab 用的,别的 Tab 本来就是
  // "我特意点开看"的既有列表,谈不上"新到达"。
  const seenQueueIds = useRef<Set<string> | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const res = await fetchForTab(tab, searchText);
      if (res.code === 0) {
        setItems(res.data);
        if (tab === "queue") {
          const currentIds = new Set(res.data.map((it) => it.caseId));
          if (seenQueueIds.current) {
            const added = [...currentIds].filter((id) => !seenQueueIds.current!.has(id));
            if (added.length > 0) setNewCount((n) => n + added.length);
          }
          seenQueueIds.current = currentIds;
        }
      }
      setLoading(false);
    },
    [tab, searchText],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 待处理这个 Tab 一直轮询(不管当前在不在这个 Tab 上)——角标要能提醒"你不在这个 Tab 时也有新案件"。
  useEffect(() => {
    const timer = setInterval(() => {
      if (tab === "queue") {
        void load({ silent: true });
      } else {
        void api.fetchQueue().then((res) => {
          if (res.code !== 0) return;
          const currentIds = new Set(res.data.map((it) => it.caseId));
          if (seenQueueIds.current) {
            const added = [...currentIds].filter((id) => !seenQueueIds.current!.has(id));
            if (added.length > 0) setNewCount((n) => n + added.length);
          } else {
            seenQueueIds.current = currentIds;
          }
        });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [tab, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setNewCount(0);
    setRefreshing(false);
  }, [load]);

  const filteredItems = items.filter((it) => {
    if (priorityFilter && it.priority !== priorityFilter) return false;
    if (tab !== "search" && searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      return (
        it.guestNickname.toLowerCase().includes(q) ||
        it.disruptionTitle.toLowerCase().includes(q) ||
        it.confirmationNo.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return {
    tab,
    setTab,
    searchText,
    setSearchText,
    items: filteredItems,
    loading,
    refreshing,
    refresh,
    priorityFilter,
    setPriorityFilter,
    newCount,
    runSearch: () => void load(),
  };
}
