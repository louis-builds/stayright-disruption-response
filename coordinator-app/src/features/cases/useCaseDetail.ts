import { useCallback, useEffect, useMemo, useState } from "react";
import * as optionsApi from "../options/api";
import type { AdminOption } from "../options/types";
import * as api from "./api";
import type { CaseMessage, CaseSummary, MessageThread } from "./types";

const POLL_INTERVAL_MS = 8_000;

export function useCaseDetail(caseId: string) {
  const [caseInfo, setCaseInfo] = useState<CaseSummary | null>(null);
  const [thread, setThread] = useState<MessageThread>("coordinator");
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [options, setOptions] = useState<AdminOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsBusy, setOptionsBusy] = useState(false);

  const refreshCase = useCallback(async () => {
    const res = await api.fetchCase(caseId);
    if (res.code === 0) setCaseInfo(res.data);
  }, [caseId]);

  const refreshMessages = useCallback(async () => {
    const res = await api.fetchMessages(caseId, thread);
    if (res.code === 0) setMessages(res.data.list);
  }, [caseId, thread]);

  const refreshOptions = useCallback(async () => {
    const res = await optionsApi.listOptions(caseId);
    if (res.code === 0) setOptions(res.data);
    setOptionsLoading(false);
  }, [caseId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      await Promise.all([refreshCase(), refreshMessages()]);
      if (!cancelled) setLoading(false);
    })();
    const timer = setInterval(() => {
      void refreshCase();
      void refreshMessages();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshCase, refreshMessages]);

  useEffect(() => {
    void refreshOptions();
  }, [refreshOptions]);

  const sendMessage = useCallback(
    async (content: string) => {
      setSending(true);
      try {
        const res = await api.postMessage(caseId, content, "coordinator");
        if (res.code === 0) setMessages((prev) => [...prev, res.data]);
      } finally {
        setSending(false);
      }
    },
    [caseId],
  );

  const vote = useCallback(
    async (messageId: string, value: "like" | "dislike") => {
      const res = await api.voteMessage(caseId, messageId, value);
      if (res.code === 0) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, vote: value } : m)));
      }
    },
    [caseId],
  );

  const markMessageRead = useCallback(
    async (messageId: string) => {
      await api.markMessageRead(caseId, messageId);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m)));
    },
    [caseId],
  );

  const unreadIncomingIds = useMemo(
    () => messages.filter((m) => !m.readAt && m.senderRole !== "coordinator").map((m) => m.id),
    [messages],
  );

  const reviewEscalation = useCallback(
    async (reasonable: boolean, note?: string) => {
      await api.reviewEscalation(caseId, reasonable, note);
      await refreshCase();
    },
    [caseId, refreshCase],
  );

  const closeCase = useCallback(
    async (closeReason: string, resultSummary: string) => {
      await api.closeCase(caseId, closeReason, resultSummary);
      await refreshCase();
    },
    [caseId, refreshCase],
  );

  const regenerateOptions = useCallback(async () => {
    setOptionsBusy(true);
    try {
      await optionsApi.regenerateOptions(caseId);
      await refreshOptions();
    } finally {
      setOptionsBusy(false);
    }
  }, [caseId, refreshOptions]);

  const pushOptions = useCallback(async () => {
    setOptionsBusy(true);
    try {
      const res = await optionsApi.pushOptions(caseId);
      await refreshOptions();
      return res;
    } finally {
      setOptionsBusy(false);
    }
  }, [caseId, refreshOptions]);

  return {
    caseInfo,
    thread,
    setThread,
    messages,
    loading,
    sending,
    sendMessage,
    vote,
    markMessageRead,
    unreadIncomingIds,
    reviewEscalation,
    closeCase,
    options,
    optionsLoading,
    optionsBusy,
    regenerateOptions,
    pushOptions,
    refreshOptions,
  };
}
