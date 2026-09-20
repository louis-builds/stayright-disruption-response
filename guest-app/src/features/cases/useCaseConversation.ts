import { useCallback, useEffect, useState } from "react";
import * as api from "./api";
import { markCaseNotificationsRead } from "../notifications/api";
import type { CaseMessage, CaseSummary, Thread } from "./types";

const POLL_INTERVAL_MS = 8_000;

export function useCaseConversation(caseId: string, thread: Thread) {
  const [caseInfo, setCaseInfo] = useState<CaseSummary | null>(null);
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshMessages = useCallback(async () => {
    const res = await api.fetchMessages(caseId, thread);
    if (res.code === 0) setMessages(res.data.list);
  }, [caseId, thread]);

  const refreshCaseInfo = useCallback(async () => {
    const res = await api.fetchCase(caseId);
    if (res.code === 0) setCaseInfo(res.data);
  }, [caseId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      await Promise.all([refreshCaseInfo(), refreshMessages()]);
      if (cancelled) return;
      await Promise.all([api.markThreadRead(caseId, thread), markCaseNotificationsRead(caseId)]);
      setLoading(false);
    })();

    const timer = setInterval(() => {
      void refreshMessages();
      void refreshCaseInfo();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [caseId, thread, refreshMessages, refreshCaseInfo]);

  const sendMessage = useCallback(
    async (content: string) => {
      setSending(true);
      setError(null);
      const tempId = `temp-${Date.now()}`;
      const optimistic: CaseMessage = {
        id: tempId,
        caseId,
        senderRole: "guest",
        content,
        vote: null,
        thread,
        createdAt: new Date().toISOString(),
        readAt: null,
        attachmentJson: null,
      };
      setMessages((prev) => [...prev, optimistic]);
      try {
        if (thread === "ai") {
          const res = await api.postChatMessage(caseId, content);
          if (res.code !== 0) throw new Error(res.message);
          setMessages((prev) => [...prev.filter((m) => m.id !== tempId), ...res.data]);
        } else {
          const res = await api.postMessage(caseId, content, thread);
          if (res.code !== 0) throw new Error(res.message);
          setMessages((prev) => [...prev.filter((m) => m.id !== tempId), res.data]);
        }
        await api.markThreadRead(caseId, thread);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setError(err instanceof Error ? err.message : "Failed to send message");
      } finally {
        setSending(false);
      }
    },
    [caseId, thread],
  );

  // 通用功能优化需求.txt 第4条:除了8秒自动轮询,补一个手动下拉刷新——网络不稳时不用干等
  // 下一次轮询,这是移动端下拉刷新的标准预期动作。
  const refresh = useCallback(async () => {
    await Promise.all([refreshCaseInfo(), refreshMessages()]);
  }, [refreshCaseInfo, refreshMessages]);

  // 单条消息已读:客人在消息气泡上停留满3秒后调用(见 CaseConversationScreen 的可见性检测),
  // 本地乐观更新 readAt,不用等下一次轮询才看到未读徽章清零——跟 Web 端 useCaseConversation.ts
  // 同一套约定(MarkThreadReadAsync 后端注释写得很清楚:清铃铛是清铃铛,消息已读按单条来,
  // 这两件事故意拆开,客户端App漏了这半边就是漏了个真功能,不是次要打磨)。
  const markMessageRead = useCallback(
    async (messageId: string) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, readAt: new Date().toISOString() } : m)));
      try {
        await api.markMessageRead(caseId, messageId);
      } catch {
        // 静默失败即可:下一次 8 秒轮询会用后端真实数据纠正。
      }
    },
    [caseId],
  );

  const vote = useCallback(
    async (messageId: string, value: "like" | "dislike") => {
      let previous: CaseMessage["vote"];
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          previous = m.vote;
          return { ...m, vote: value };
        }),
      );
      try {
        await api.voteMessage(caseId, messageId, value);
      } catch {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, vote: previous } : m)));
      }
    },
    [caseId],
  );

  return { caseInfo, messages, loading, sending, error, sendMessage, refresh, markMessageRead, vote };
}
