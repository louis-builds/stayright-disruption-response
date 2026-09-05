import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { markCaseNotificationsRead } from "../notifications/api";
import type { CaseMessage, CaseSummary, Thread } from "./types";

const POLL_INTERVAL_MS = 8_000;

export function useCaseConversation(caseId: string, role: string, thread: Thread) {
  const [caseInfo, setCaseInfo] = useState<CaseSummary | null>(null);
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const knownIds = useRef(new Set<string>());

  const refreshMessages = useCallback(async () => {
    const res = await api.fetchMessages(caseId, thread);
    if (res.code === 0) {
      setMessages(res.data.list);
      for (const m of res.data.list) knownIds.current.add(m.id);
    }
  }, [caseId, thread]);

  // caseInfo 也跟着轮询，不止在挂载/切 tab 时拉一次——转人工后协调员页签要在页面上自己冒出来，
  // 不能靠客人手动刷新页面才看到（escalated/未读数都是从这个字段来的）。
  const refreshCaseInfo = useCallback(async () => {
    const res = await api.fetchCase(caseId);
    if (res.code === 0) setCaseInfo(res.data);
  }, [caseId]);

  // thread 变化(切 tab)要重新拉取+标记已读+重开轮询——两条线程各自独立,不是同一份数据换个筛选。
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

      // 客人自己发的这条先乐观显示出来，不用等 AI 回完才一起冒出来——用临时 id 占位，
      // 拿到真实返回后按 id 替换掉，避免出现内容重复的两条。
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimisticMessage: CaseMessage = {
        id: tempId, caseId, senderRole: "guest", content, vote: null, thread, createdAt: new Date().toISOString(), readAt: null,
      };
      setMessages((prev) => [...prev, optimisticMessage]);

      try {
        // /chat 只对 guest 开放,还会触发 AI 自动回复,而且只在 ai 线程用——guest 在 coordinator
        // 线程回复、或任何非 guest 角色发消息,都走不触发 AI 的普通消息接口。
        if (role === "guest" && thread === "ai") {
          const res = await api.postChatMessage(caseId, content);
          if (res.code !== 0) throw new Error(res.message);
          setMessages((prev) => [...prev.filter((m) => m.id !== tempId), ...res.data]);
          for (const m of res.data) knownIds.current.add(m.id);
        } else {
          const res = await api.postMessage(caseId, content, thread);
          if (res.code !== 0) throw new Error(res.message);
          setMessages((prev) => [...prev.filter((m) => m.id !== tempId), res.data]);
          knownIds.current.add(res.data.id);
        }
        await api.markThreadRead(caseId, thread);
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setError(err instanceof Error ? err.message : "Failed to send message");
      } finally {
        setSending(false);
      }
    },
    [caseId, role, thread],
  );

  const vote = useCallback(
    async (messageId: string, value: "like" | "dislike") => {
      // 乐观更新之前没有失败回滚：接口调用没包 try/catch，投票请求真失败时（网络错误等）
      // UI 会一直显示"已投票"这个错误状态，用户毫无察觉，直到下一次 8 秒轮询或手动刷新
      // 才会被后端的真实数据悄悄纠正过来——这段时间里点了这个按钮的人以为投票生效了，其实没有。
      // previous 靠 setMessages 的 updater 函数当场读出旧值，失败时原样滚回去，不额外起一个 ref。
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

  // 单条消息已读：客人在消息气泡上停留满3秒后调用，本地乐观更新 readAt，不用等下一次轮询才看到渐变。
  const markMessageRead = useCallback(
    async (messageId: string) => {
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, readAt: new Date().toISOString() } : m)));
      try {
        await api.markMessageRead(caseId, messageId);
      } catch {
        // 静默失败即可：下一次 8 秒轮询会用后端真实数据纠正，未读徽章届时也会同步回正确值。
      }
    },
    [caseId],
  );

  return { caseInfo, messages, loading, sending, error, sendMessage, vote, markMessageRead };
}
