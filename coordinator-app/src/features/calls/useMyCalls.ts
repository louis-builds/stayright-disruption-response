import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import type { CalleeType, Call } from "./types";

export function useMyCalls() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [calleeTypeFilter, setCalleeTypeFilter] = useState<CalleeType | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  const load = useCallback(async () => {
    const res = await api.listMine({
      calleeType: calleeTypeFilter ?? undefined,
      status: statusFilter ?? undefined,
      pageSize: 50,
    });
    if (res.code === 0) setCalls(res.data.list);
    setLoading(false);
  }, [calleeTypeFilter, statusFilter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const filtered = calls.filter((c) => {
    if (!searchText.trim()) return true;
    const q = searchText.trim().toLowerCase();
    return (
      (c.guestNickname?.toLowerCase().includes(q) ?? false) ||
      (c.hotelName?.toLowerCase().includes(q) ?? false) ||
      (c.confirmationNo?.toLowerCase().includes(q) ?? false)
    );
  });

  return {
    calls: filtered,
    loading,
    refreshing,
    refresh,
    calleeTypeFilter,
    setCalleeTypeFilter,
    statusFilter,
    setStatusFilter,
    searchText,
    setSearchText,
  };
}
