import { useCallback, useEffect, useRef, useState } from "react";
import * as tagsApi from "../../shared/api/tags";
import type { CustomTag, GuestTags } from "../../shared/api/tags";
import type { InquiryItem, SelectedOptionItem } from "../inbox/types";
import * as api from "./api";
import type { DoneItem } from "./types";

// 跟 Web 端 HotelHomePage.tsx 的 Done 标签同一套合并展示逻辑：酒店只关心"我处理过哪些客人请求"，
// 不关心背后是延期询单(H1)还是候补方案(H2)——分开两块列表容易让人以为漏了数据。
export function useHistory() {
  const [doneInquiries, setDoneInquiries] = useState<InquiryItem[]>([]);
  const [doneOptions, setDoneOptions] = useState<SelectedOptionItem[]>([]);
  const [customTags, setCustomTags] = useState<CustomTag[]>([]);
  const [guestTags, setGuestTags] = useState<Record<string, GuestTags>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequestIdRef = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    else setRefreshing(true);
    const requestId = ++latestRequestIdRef.current;
    const [inqRes, optRes] = await Promise.all([api.fetchAllInquiries(), api.fetchSelectedOptionsHistory()]);
    if (requestId === latestRequestIdRef.current) {
      const inquiries = inqRes.code === 0 ? inqRes.data.filter((i) => i.status !== "pending") : [];
      if (inqRes.code === 0) setDoneInquiries(inquiries);
      if (optRes.code === 0) setDoneOptions(optRes.data);
      setLoading(false);
      setRefreshing(false);

      const guestIds = [...inquiries, ...(optRes.code === 0 ? optRes.data : [])]
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

  const reloadTagsFor = useCallback(async (guestUserId: string) => {
    const [listRes, guestRes] = await Promise.all([tagsApi.fetchCustomTags(), tagsApi.fetchGuestTags(guestUserId)]);
    if (listRes.code === 0) setCustomTags(listRes.data);
    if (guestRes.code === 0) setGuestTags((prev) => ({ ...prev, [guestUserId]: guestRes.data }));
  }, []);

  const doneItems: DoneItem[] = [
    ...doneInquiries.map((i): DoneItem => ({
      id: i.id,
      kind: "inquiry",
      confirmationNo: i.confirmationNo,
      guestNickname: i.guestNickname,
      isReturningGuest: i.isReturningGuest,
      isHighValueGuest: i.isHighValueGuest,
      guestUserId: i.guestUserId,
      label: i.disruptionTitle,
      statusTag: i.status === "accepted" ? "accepted" : "rejected",
      timestamp: i.respondedAt ?? "",
      reason: i.status === "rejected" ? i.rejectReason : null,
      finalOutcome: i.status === "accepted" && i.finalOutcome === "moved" ? "Guest moved to another hotel" : null,
      dateInfo:
        i.finalOutcome === "stayed"
          ? `Guest confirmed the deferral — final dates: ${i.checkIn} → ${i.checkOut}`
          : i.status === "accepted" && i.proposedNewCheckIn && i.proposedNewCheckOut
            ? `Proposed dates: ${i.proposedNewCheckIn} → ${i.proposedNewCheckOut} (estimated)`
            : null,
    })),
    ...doneOptions.map((o): DoneItem => ({
      id: o.optionId,
      kind: "option",
      confirmationNo: o.confirmationNo,
      guestNickname: o.guestNickname,
      isReturningGuest: o.isReturningGuest,
      isHighValueGuest: o.isHighValueGuest,
      guestUserId: o.guestUserId,
      label: o.optionType,
      statusTag: o.availability === "available" ? "confirmed" : "declined",
      timestamp: o.selectedSince,
      reason: o.availability === "unavailable" ? o.unavailableReason : null,
      finalOutcome: null,
      dateInfo: null,
    })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const acceptedCount = doneInquiries.filter((i) => i.status === "accepted").length;
  const rejectedCount = doneInquiries.filter((i) => i.status === "rejected").length;
  const availableCount = doneOptions.filter((o) => o.availability === "available").length;
  const unavailableCount = doneOptions.filter((o) => o.availability === "unavailable").length;

  return {
    loading,
    refreshing,
    doneItems,
    customTags,
    guestTags,
    stats: {
      inquiryTotal: doneInquiries.length,
      acceptedCount,
      rejectedCount,
      optionTotal: doneOptions.length,
      availableCount,
      unavailableCount,
    },
    refresh,
    reloadTagsFor,
  };
}
