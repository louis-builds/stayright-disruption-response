import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { RoleTopNav } from "../../shared/components/RoleTopNav";
import { useAuth } from "../auth";
import { useCaseConversation } from "./useCaseConversation";
import { fetchTopFaqQuestions } from "./api";
import type { CaseMessage, SenderRole, Thread } from "./types";
import "./CaseConversationPage.css";
import { CoordinatorCaseWorkspacePage } from "../coordinator/CoordinatorCaseWorkspacePage";

const ROLE_META: Record<SenderRole, { label: string; avatar: string }> = {
  guest: { label: "You", avatar: "🧳" },
  ai: { label: "AI Assistant", avatar: "🤖" },
  system: { label: "System", avatar: "ℹ️" },
  coordinator: { label: "Coordinator", avatar: "🧑‍💼" },
};

// 假流式：内容已经整段拿到手了，只是本地按字符逐步显示，制造"AI正在打字"的观感。
// 没有真的分段请求后端，服务端压力跟一次性返回完全一样。
function useTypewriter(text: string, enabled: boolean) {
  const [shown, setShown] = useState(enabled ? "" : text);
  useEffect(() => {
    if (!enabled) {
      setShown(text);
      return;
    }
    setShown("");
    let i = 0;
    const id = setInterval(() => {
      i += 3;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 20);
    return () => clearInterval(id);
  }, [text, enabled]);
  return shown;
}

function MessageBubble({
  message,
  onVote,
  viewerRole,
  typewriter,
}: {
  message: CaseMessage;
  onVote: (v: "like" | "dislike") => void;
  viewerRole: string;
  typewriter?: boolean;
}) {
  const meta = ROLE_META[message.senderRole];
  const isGuest = message.senderRole === "guest";
  // 自己发的消息不需要已读标记——只标"对方发给我的这条我读了没"，跟后端 SenderRole != readerRole 的口径一致。
  const isOwnMessage = message.senderRole === viewerRole;
  const isRead = !!message.readAt;
  const displayedContent = useTypewriter(message.content, !!typewriter);

  return (
    <div className={`msg-row ${isGuest ? "msg-row-mine" : ""}`}>
      <span className="msg-avatar" aria-hidden="true">
        {meta.avatar}
      </span>
      <div className="msg-bubble-wrap" data-message-id={message.id} data-unread-msg={!isOwnMessage && !isRead ? "true" : undefined}>
        <div className="msg-meta">
          <span className="msg-sender">{meta.label}</span>
          <span className="msg-time">{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div className="msg-bubble-line">
          <div className={`msg-bubble msg-bubble-${message.senderRole}`}>{displayedContent}</div>
          {!isOwnMessage && (
            <span className={`msg-read-indicator ${isRead ? "msg-read-indicator-read" : "msg-read-indicator-unread"}`}>
              {isRead ? "Read" : "Unread"}
            </span>
          )}
        </div>
        {message.senderRole === "ai" && (
          <div className="msg-votes">
            <button
              className={`msg-vote ${message.vote === "like" ? "msg-vote-active" : ""}`}
              onClick={() => onVote("like")}
              aria-label="Helpful"
            >
              👍
            </button>
            <button
              className={`msg-vote ${message.vote === "dislike" ? "msg-vote-active" : ""}`}
              onClick={() => onVote("dislike")}
              aria-label="Not helpful"
            >
              👎
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function LegacyCaseConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  // guest 的主流程是问 AI,默认落在 ai 线程;协调员(以及理论上的酒店角色)进这页通常就是为了
  // 回复客人,默认落在 coordinator 线程。
  const [thread, setThread] = useState<Thread>(user?.role === "guest" ? "ai" : "coordinator");
  const viewerRole = user?.role ?? "guest";
  const { caseInfo, messages, loading, sending, error, sendMessage, vote, markMessageRead } = useCaseConversation(id!, viewerRole, thread);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // 非 guest 角色不能往 ai 线程发消息(AI 从不接协调员的话),这个 tab 对他们是只读的。
  const canPostHere = user?.role === "guest" || thread === "coordinator";

  // 全平台高频问题——后端每天0点批量聚类，这里挂载时拉一次就够，不用跟着 8 秒轮询。
  const [faqQuestions, setFaqQuestions] = useState<{ text: string; askCount: number }[]>([]);
  useEffect(() => {
    if (viewerRole !== "guest") return;
    fetchTopFaqQuestions().then((res) => {
      if (res.code === 0) setFaqQuestions(res.data);
    });
  }, [viewerRole]);

  // loading/sending 都要进依赖，且用 useLayoutEffect 不用 useEffect：
  // 1) 初次进页面时 messages 从 refreshMessages() 落地和 loading 变 false 是两次独立的
  //    setState（同一个 async 函数里但隔着一次 await，不保证同批渲染）——真被拆成两次渲染时，
  //    messages.length 变化那一次命中的还是"Loading conversation…"占位段落（scrollHeight 很小），
  //    等 loading 真的变 false、消息列表实际渲染出来，messages.length 没再变，原来只依赖
  //    messages.length 的 effect 不会再跑第二次，最新消息停留在可视区域外，用户看不到。
  // 2) 发消息时 sending 从 true 变 false 那一刻，"AI 正在输入"的占位气泡从 DOM 里消失，
  //    容器实际内容高度跟着变——不把 sending 也列进依赖，这次高度变化不会触发重新滚动。
  // 3) useEffect 是"画面画完之后"才跑，跟其它 effect/批量渲染穿插的顺序不保证；
  //    useLayoutEffect 在浏览器画下一帧之前、DOM 变更刚提交完就同步跑，量 scrollHeight
  //    时读到的一定是最新提交的布局，不会因为跟别的更新前后脚发生而量到中间态的高度。
  // 线上验证过真的会踩到最新消息卡在可视区域外的情况，不是假设。
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, loading, sending]);

  // sending 从 true 变 false 那一刻，AI 的回复刚落地——只对这一条播打字机效果，
  // 8 秒轮询带回来的历史消息、协调员消息都不算，不然每次轮询都重播一遍。
  const wasSendingRef = useRef(false);
  const [typewriterId, setTypewriterId] = useState<string | null>(null);
  useEffect(() => {
    if (wasSendingRef.current && !sending && thread === "ai") {
      const lastAi = [...messages].reverse().find((m) => m.senderRole === "ai");
      if (lastAi) setTypewriterId(lastAi.id);
    }
    wasSendingRef.current = sending;
  }, [sending, messages, thread]);

  // unreadIds 而不是直接依赖 messages：8 秒轮询每次都会换一个新的数组引用，即使内容没变——
  // 直接依赖 messages 会让下面这个 effect 每次轮询都重建 observer、打断正在计时的 3 秒停留。
  const unreadIds = messages
    .filter((m) => !m.readAt && m.senderRole !== viewerRole)
    .map((m) => m.id)
    .join(",");

  // 停留满 3 秒才算已读：气泡露出一点点就启动计时器，滑出可视区域就清掉，没有半途算数的已读。
  // 用 getBoundingClientRect 手动算可见性、不用 IntersectionObserver——后者的回调依赖浏览器真正
  // 走完一次绘制/合成，标签页被系统判定为"后台"时(切走、最小化、笔记本合盖)绘制会被搁置，
  // 回调可能长时间不来，计时器永远起不了；矩形几何只要布局算完就能读到，不用等绘制，更可靠。
  // loading 也要进依赖：首次进页面时 messages 落地(unreadIds 变化)和 loading 变 false 是两次
  // 独立渲染(隔着 markThreadRead 那次 await)——真被拆成两次时，unreadIds 变化那一次命中的还是
  // "Loading conversation…" 占位段落，DOM 里根本没有消息气泡，check() 找到 0 个目标；等 loading
  // 真变 false、气泡实际渲染出来，unreadIds 没再变，这个 effect 不会重新跑，计时器永远起不来——
  // 跟上面滚动那个 useLayoutEffect 踩的是同一个坑，同样需要把 loading 列进依赖里再触发一次检查。
  // ponytail: 同一条消息在两次不同 thread/挂载周期里各自计时，不做跨检查实例的状态迁移。
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !unreadIds) return;

    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const isVisible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      return r.bottom > c.top && r.top < c.bottom;
    };

    const check = () => {
      const visibleIds = new Set<string>();
      container.querySelectorAll<HTMLElement>("[data-unread-msg]").forEach((el) => {
        const messageId = el.dataset.messageId;
        if (!messageId || !isVisible(el)) return;
        visibleIds.add(messageId);
        if (timers.has(messageId)) return;
        timers.set(
          messageId,
          setTimeout(() => {
            timers.delete(messageId);
            void markMessageRead(messageId);
          }, 3000),
        );
      });
      for (const [messageId, timer] of timers) {
        if (!visibleIds.has(messageId)) {
          clearTimeout(timer);
          timers.delete(messageId);
        }
      }
    };

    check();
    container.addEventListener("scroll", check, { passive: true });
    return () => {
      container.removeEventListener("scroll", check);
      timers.forEach((t) => clearTimeout(t));
    };
  }, [unreadIds, markMessageRead, loading]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    const content = draft;
    setDraft("");
    await sendMessage(content);
  }

  if (!user) return null;

  return (
    <AppShell centerContent={<RoleTopNav role={user.role} />} showBack>
      <div className="case-layout">
      <div className="case-page">
        {caseInfo && (
          <div className="case-header">
            <div>
              <p className="case-header-title">{caseInfo.disruptionTitle ?? "Disruption case"}</p>
              <p className="case-header-sub">
                {caseInfo.hotelName}
                {caseInfo.checkIn && caseInfo.checkOut ? ` · ${caseInfo.checkIn} → ${caseInfo.checkOut}` : ""}
              </p>
            </div>
            <div className="case-header-actions">
              <span className={`tag tag-status tag-status-${caseInfo.status}`}>{caseInfo.statusLabel}</span>
            </div>
          </div>
        )}

        {/* 客人默认只看得到 AI 页签——协调员页签在真正转人工(caseInfo.escalated)之后才出现，
            不刷新页面靠 useCaseConversation 里 caseInfo 也跟着轮询。协调员/酒店角色不受这道门槛限制，
            他们打开案件本来就是要去协调员线程沟通的。 */}
        {(user.role !== "guest" || caseInfo?.escalated) && (
          <div className="case-tabs">
            <button
              type="button"
              className={`case-tab ${thread === "ai" ? "case-tab-active" : ""}`}
              onClick={() => setThread("ai")}
            >
              AI conversation
              {!!caseInfo?.unreadAiCount && <span className="case-tab-badge">{caseInfo.unreadAiCount}</span>}
            </button>
            <button
              type="button"
              className={`case-tab ${thread === "coordinator" ? "case-tab-active" : ""}`}
              onClick={() => setThread("coordinator")}
            >
              Coordinator conversation
              {!!caseInfo?.unreadCoordinatorCount && <span className="case-tab-badge">{caseInfo.unreadCoordinatorCount}</span>}
            </button>
          </div>
        )}

        <div className="case-thread" ref={scrollRef}>
          {loading ? (
            <p className="case-loading">Loading conversation…</p>
          ) : messages.length === 0 ? (
            <p className="case-empty">
              {thread === "coordinator" ? "No messages with your coordinator yet." : "No messages yet."}
            </p>
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onVote={(v) => void vote(m.id, v)}
                viewerRole={viewerRole}
                typewriter={m.id === typewriterId}
              />
            ))
          )}
          {sending && (
            <div className="msg-row">
              <span className="msg-avatar" aria-hidden="true">
                🤖
              </span>
              <div className="msg-bubble-wrap">
                <div className="msg-bubble msg-bubble-ai msg-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <p className="case-error">{error}</p>}

        {canPostHere ? (
          <form className="case-composer" onSubmit={handleSubmit}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              disabled={sending}
            />
            <button type="submit" disabled={sending || !draft.trim()}>
              {sending ? <span className="case-send-spinner" aria-hidden="true" /> : "Send"}
            </button>
          </form>
        ) : (
          <p className="case-readonly-note">Read-only — this is the guest's conversation with the AI assistant.</p>
        )}
      </div>

      {caseInfo && (
        <aside className="case-side">
          <div className="case-side-card">
            <h3>Case details</h3>
            <dl className="case-side-list">
              <div>
                <dt>Hotel</dt>
                <dd>{caseInfo.hotelName ?? "—"}</dd>
              </div>
              <div>
                <dt>Disruption</dt>
                <dd>
                  {caseInfo.disruptionType && <span className="tag tag-type">{caseInfo.disruptionType}</span>}
                  {" "}
                  {caseInfo.disruptionTitle ?? "—"}
                </dd>
              </div>
              {caseInfo.checkIn && caseInfo.checkOut && (
                <div>
                  <dt>Stay dates</dt>
                  <dd>
                    {caseInfo.checkIn} → {caseInfo.checkOut}
                  </dd>
                </div>
              )}
              <div>
                <dt>Priority</dt>
                <dd className="case-side-priority">{caseInfo.priority}</dd>
              </div>
              <div>
                <dt>Messages</dt>
                <dd>{messages.length}</dd>
              </div>
            </dl>
            {caseInfo.status === "closed" ? (
              <p className="case-side-closed-note">
                This case is resolved — options are no longer editable. Check the conversation above for the final outcome.
              </p>
            ) : (
              <button type="button" className="case-side-options-btn" onClick={() => navigate(`/cases/${id}/options`)}>
                View rebooking options →
              </button>
            )}
          </div>

          <div className="case-side-card case-side-tip">
            {viewerRole === "guest" && faqQuestions.length > 0 ? (
              <>
                <h3>Frequently asked</h3>
                <div className="case-faq-list">
                  {faqQuestions.map((q) => (
                    <button key={q.text} type="button" className="case-faq-chip" onClick={() => setDraft(q.text)}>
                      {q.text}
                    </button>
                  ))}
                </div>
              </>
            ) : thread === "ai" ? (
              <>
                <h3>How replies work</h3>
                <p>
                  An AI assistant answers first using this case's policy and history. If a question is complex, ambiguous,
                  or you've asked a few times without resolution, it hands off to a human coordinator automatically —
                  no need to ask twice.
                </p>
              </>
            ) : (
              <>
                <h3>How replies work</h3>
                <p>This is a direct, human-only conversation with your assigned coordinator — the AI assistant never reads or replies here.</p>
              </>
            )}
          </div>
        </aside>
      )}
      </div>
    </AppShell>
  );
}

export function CaseConversationPage() {
  const { user } = useAuth();
  return user?.role === "coordinator" ? <CoordinatorCaseWorkspacePage /> : <LegacyCaseConversationPage />;
}
