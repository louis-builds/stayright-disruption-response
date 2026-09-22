import { useCallback, useEffect, useRef, useState } from "react";
import * as tagsApi from "../../shared/api/tags";
import type { CustomTag, GuestTags } from "../../shared/api/tags";
import * as api from "./api";
import type { HotelPerk, InquiryItem, SelectedOptionItem, TodoItem } from "./types";

// 跟 Web 端 HotelHomePage.tsx 的 refresh() 同一个坑：轮询请求可能乱序落地，给每次调用
// 领一个序号，只有序号还是最新的那次才允许写 state，避免旧响应把新数据覆盖回去。
export function useInbox() {
  const [pendingInquiries, setPendingInquiries] = useState<InquiryItem[]>([]);
  const [pendingOptions, setPendingOptions] = useState<SelectedOptionItem[]>([]);
  const [perks, setPerks] = useState<HotelPerk[]>([]);
  const [profileSnapshot, setProfileSnapshot] = useState<{ name: string; address: string; roomTypeCount: number } | null>(null);
  const [customTags, setCustomTags] = useState<CustomTag[]>([]);
  const [guestTags, setGuestTags] = useState<Record<string, GuestTags>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // busyId 曾经是单个 string——两个不同卡片先后点 Confirm 时，第二次点击会把 busyId 覆盖成
  // 别的 id，第一张卡片的按钮又变回可点、spinner 也消失，其实它的请求还没返回，等于让人有机会
  // 对同一张卡片点两次 Confirm。round 2 已经在三个弹窗上遇到过同一类"state 更新不够同步"的坑
  // (改成 inFlight ref 才真正堵住)，这里同理换成 Set，且用 ref 做真正的同步拦截，state 只负责渲染。
  const inFlightIds = useRef<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const latestRequestIdRef = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    else setRefreshing(true);
    const requestId = ++latestRequestIdRef.current;
    const [inqRes, optRes, profileRes] = await Promise.all([
      api.fetchInquiries("pending"),
      api.fetchSelectedOptions(),
      api.fetchProfileSummary(),
    ]);
    if (requestId === latestRequestIdRef.current) {
      if (inqRes.code === 0) setPendingInquiries(inqRes.data);
      if (optRes.code === 0) setPendingOptions(optRes.data);
      if (profileRes.code === 0) {
        setPerks(profileRes.data.perks);
        setProfileSnapshot({ name: profileRes.data.name, address: profileRes.data.address, roomTypeCount: profileRes.data.roomTypes.length });
      }
      setLoading(false);
      setRefreshing(false);
      setSyncedAt(new Date());

      const guestIds = [...(inqRes.code === 0 ? inqRes.data : []), ...(optRes.code === 0 ? optRes.data : [])]
        .map((x) => x.guestUserId)
        .filter((x): x is string => Boolean(x));
      if (guestIds.length > 0) {
        const tagRes = await tagsApi.queryGuestTags([...new Set(guestIds)]);
        if (requestId === latestRequestIdRef.current && tagRes.code === 0) setGuestTags(tagRes.data);
      }
    }
  }, []);

  useEffect(() => {
    void tagsApi.fetchCustomTags().then((res) => {
      if (res.code === 0) setCustomTags(res.data);
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 待办是随时可能有新请求进来的实时队列，跟 Web 端一致用 30 秒静默轮询，不打断正在看的卡片。
  useEffect(() => {
    const timer = setInterval(() => void refresh({ silent: true }), 30_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const reloadTagsFor = useCallback(async (guestUserId: string) => {
    const [listRes, guestRes] = await Promise.all([tagsApi.fetchCustomTags(), tagsApi.fetchGuestTags(guestUserId)]);
    if (listRes.code === 0) setCustomTags(listRes.data);
    if (guestRes.code === 0) setGuestTags((prev) => ({ ...prev, [guestUserId]: guestRes.data }));
  }, []);

  async function confirmInquiry(id: string, newCheckIn?: string | null, newCheckOut?: string | null, note?: string) {
    if (inFlightIds.current.has(id)) return;
    inFlightIds.current.add(id);
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await api.confirmInquiry(id, newCheckIn, newCheckOut, note);
      await refresh({ silent: true });
    } finally {
      inFlightIds.current.delete(id);
      setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  async function rejectInquiry(id: string, reason: string) {
    await api.rejectInquiry(id, reason);
    await refresh({ silent: true });
  }

  async function confirmOption(optionId: string) {
    if (inFlightIds.current.has(optionId)) return;
    inFlightIds.current.add(optionId);
    setBusyIds((prev) => new Set(prev).add(optionId));
    try {
      await api.confirmOption(optionId);
      await refresh({ silent: true });
    } finally {
      inFlightIds.current.delete(optionId);
      setBusyIds((prev) => { const next = new Set(prev); next.delete(optionId); return next; });
    }
  }

  async function rejectOption(optionId: string, reason: string) {
    await api.rejectOption(optionId, reason);
    await refresh({ silent: true });
  }

  async function saveOptionPerks(optionId: string, perkNames: string[]) {
    await api.setOptionPerks(optionId, perkNames);
    await refresh({ silent: true });
  }

  async function offerCustomOption(caseId: string, title: string, perkNames: string[]) {
    await api.createCustomOption(caseId, title, perkNames);
    await refresh({ silent: true });
  }

  const todoItems: TodoItem[] = [
    ...pendingInquiries.map((item): TodoItem => ({ kind: "inquiry", item })),
    ...pendingOptions.map((item): TodoItem => ({ kind: "option", item })),
  ].sort((a, b) => {
    const aOverdue = a.kind === "inquiry" && a.item.overdue;
    const bOverdue = b.kind === "inquiry" && b.item.overdue;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    const aCommitted = a.kind === "inquiry" && a.item.guestCommitted;
    const bCommitted = b.kind === "inquiry" && b.item.guestCommitted;
    if (aCommitted !== bCommitted) return aCommitted ? -1 : 1;
    if (a.item.isReturningGuest !== b.item.isReturningGuest) return a.item.isReturningGuest ? -1 : 1;
    const aTime = a.kind === "inquiry" ? a.item.requestedAt : a.item.selectedSince;
    const bTime = b.kind === "inquiry" ? b.item.requestedAt : b.item.selectedSince;
    return aTime.localeCompare(bTime);
  });

  return {
    loading,
    refreshing,
    todoItems,
    perks,
    profileSnapshot,
    customTags,
    guestTags,
    busyIds,
    syncedAt,
    badgeCount: pendingInquiries.length + pendingOptions.length,
    overdueCount: pendingInquiries.filter((i) => i.overdue).length,
    returningCount: pendingInquiries.filter((i) => i.isReturningGuest).length + pendingOptions.filter((o) => o.isReturningGuest).length,
    refresh,
    reloadTagsFor,
    confirmInquiry,
    rejectInquiry,
    confirmOption,
    rejectOption,
    saveOptionPerks,
    offerCustomOption,
  };
}
