import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { fetchGuestTags, reviewEscalation, type GuestTags } from "../cases/api";
import { useCaseConversation } from "../cases/useCaseConversation";
import type { CaseSummary, Thread } from "../cases/types";
import { CoordinatorDashboardShell } from "./CoordinatorDashboardShell";
import { escalationReasonLabel } from "./escalationLabels";
import "./CoordinatorCaseWorkspacePage.css";

const COORDINATOR_QUICK_REPLIES = [
  "We're currently checking with the hotel and will update you as soon as possible.",
  "The hotel has confirmed your request. Please review the latest update.",
  "Your recovery options are now available. Please select the option that works best for you.",
  "Your date-change request is being processed.",
  "We're arranging an alternative hotel and will share the details shortly.",
  "Your refund request has been received and is being processed.",
  "Could you please provide more information so we can assist you?",
  "Your case has been resolved. Please let us know if you need any further assistance.",
] as const;

// 只在真的转过人工的案件上出现——没转人工就没有"这次转人工准不准"这回事。协调员的判断
// (合理/不合理+理由)是攒 AI 转人工准确率反馈的唯一入口，日后要调阈值/权重全靠这批真实数据。
function EscalationReviewPanel({ caseInfo }: { caseInfo: CaseSummary }) {
  const [choice, setChoice] = useState<"reasonable" | "unreasonable" | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState<{ reasonable: boolean; note: string | null } | null>(null);

  if (!caseInfo.escalationReason) return null;

  const reviewed = justSubmitted ?? (caseInfo.escalationReviewedAsReasonable === null
    ? null
    : { reasonable: caseInfo.escalationReviewedAsReasonable, note: caseInfo.escalationReviewNote });

  const canSubmit = choice === "reasonable" || (choice === "unreasonable" && noteDraft.trim().length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const reasonable = choice === "reasonable";
      const note = reasonable ? undefined : noteDraft.trim();
      await reviewEscalation(caseInfo.id, reasonable, note);
      setJustSubmitted({ reasonable, note: note ?? null });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="case-escalation-review">
      <small>AI escalated this case</small>
      <p className="case-escalation-reason">{escalationReasonLabel(caseInfo.escalationReason)}</p>
      {reviewed ? (
        <p className={`case-escalation-verdict ${reviewed.reasonable ? "reasonable" : "unreasonable"}`}>
          {reviewed.reasonable ? "Marked as a reasonable escalation." : `Marked as not reasonable — ${reviewed.note}`}
        </p>
      ) : (
        <form className="case-escalation-form" onSubmit={submit}>
          <span>Was escalating this case the right call?</span>
          <label>
            <input
              type="radio"
              name="escalation-verdict"
              checked={choice === "reasonable"}
              onChange={() => setChoice("reasonable")}
            />
            Reasonable
          </label>
          <label>
            <input
              type="radio"
              name="escalation-verdict"
              checked={choice === "unreasonable"}
              onChange={() => setChoice("unreasonable")}
            />
            Not reasonable
          </label>
          {choice === "unreasonable" && (
            <textarea
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Why wasn't this a reasonable escalation?"
            />
          )}
          <button disabled={submitting || !canSubmit}>{submitting ? "Saving…" : "Submit"}</button>
        </form>
      )}
    </div>
  );
}

function initials(role: string) {
  return role === "coordinator" ? "CO" : role === "guest" ? "GU" : role === "ai" ? "AI" : "SY";
}

function statusTone(status: string) {
  return status.replaceAll("_", " ");
}

function caseAge(createdAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function CoordinatorCaseWorkspacePage() {
  const { id = "" } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [thread, setThread] = useState<Thread>("coordinator");
  const [draft, setDraft] = useState("");
  const quickRepliesRef = useRef<HTMLDetailsElement>(null);
  const [guestTags, setGuestTags] = useState<GuestTags | null>(null);
  const { caseInfo, messages, loading, sending, error, sendMessage } = useCaseConversation(id, "coordinator", thread);

  // 客人标签：酒店和协调员可见、客人不可见。案件切换时清空再按新客人重拉。
  useEffect(() => {
    setGuestTags(null);
    if (caseInfo?.guestUserId) {
      void fetchGuestTags(caseInfo.guestUserId).then((res) => {
        if (res.code === 0) setGuestTags(res.data);
      });
    }
  }, [caseInfo?.guestUserId]);

  const activity = useMemo(() => {
    const rows = messages.slice(-4).reverse().map((message) => ({
      title: message.senderRole === "guest" ? "Guest message received" : message.senderRole === "coordinator" ? "Coordinator reply sent" : message.senderRole === "ai" ? "AI response recorded" : "System update",
      at: message.createdAt,
    }));
    if (caseInfo?.createdAt) rows.push({ title: "Case created", at: caseInfo.createdAt });
    return rows.slice(0, 5);
  }, [caseInfo?.createdAt, messages]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || sending || thread !== "coordinator") return;
    const content = draft.trim();
    setDraft("");
    await sendMessage(content);
  }

  if (!user) return null;

  return <CoordinatorDashboardShell user={user} active="reports" onNavigate={() => navigate("/coordinator/home")} onSearch={() => navigate("/coordinator/home")}>
    <div className="case-workspace">
      <button className="case-workspace-back" onClick={() => navigate(-1)}>← Back to Cases</button>
      {caseInfo && <header className="case-workspace-hero">
        <div><small>Active case</small><div className="case-workspace-badges"><span>CASE-{id.slice(0, 8).toUpperCase()}</span><em className={`priority-${caseInfo.priority}`}>{caseInfo.priority} priority</em><em className={`status-${caseInfo.status}`}>{caseInfo.statusLabel}</em></div><h1>{caseInfo.disruptionTitle ?? "Disruption case"}</h1><p>{caseInfo.disruptionDescription || "Travel disruption affecting this booking."}</p></div>
        <dl><div className="case-hero-guest"><dt>Guest</dt><dd>{caseInfo.guestAvatarUrl && <img src={caseInfo.guestAvatarUrl} alt=""/>}{caseInfo.guestNickname ?? "Guest not recorded"}</dd><small>{caseInfo.confirmationNo ?? "No booking reference"}</small></div><div><dt>Hotel</dt><dd>{caseInfo.hotelName ?? "—"}</dd></div><div><dt>Stay dates</dt><dd>{caseInfo.checkIn && caseInfo.checkOut ? `${caseInfo.checkIn} – ${caseInfo.checkOut}` : "Not recorded"}</dd></div></dl>
      </header>}

      <div className="case-workspace-grid">
        <section className="case-communication-card">
          <header><div><span>▢</span><div><h2>Communication Hub</h2><p>Review AI context and communicate directly with the guest</p></div></div><nav><button className={thread === "ai" ? "active" : ""} onClick={() => setThread("ai")}>AI Conversation</button><button className={thread === "coordinator" ? "active" : ""} onClick={() => setThread("coordinator")}>Guest Conversation</button></nav></header>
          <div className="case-workspace-thread">
            {loading ? <p className="case-workspace-empty">Loading conversation…</p> : messages.length === 0 ? <p className="case-workspace-empty">No messages in this conversation yet.</p> : messages.map((message) => <article key={message.id} className={`workspace-message ${message.senderRole}`}>{message.senderRole === "coordinator" && user.avatarUrl ? <img src={user.avatarUrl} alt=""/> : <i>{message.senderRole === "coordinator" ? user.nickname.slice(0, 2).toUpperCase() : initials(message.senderRole)}</i>}<div><header><strong>{message.senderRole === "guest" ? "Guest" : message.senderRole === "ai" ? "StayRight AI" : message.senderRole === "coordinator" ? user.nickname : "System"}</strong><time>{new Date(message.createdAt).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></header><p>{message.content}</p>{message.senderRole !== "coordinator" && <small>{message.readAt ? "Read" : "Unread"}</small>}</div></article>)}
          </div>
          {error && <p className="case-workspace-error">{error}</p>}
          {thread === "coordinator" ? <form onSubmit={submit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message to the guest…"/><div className="case-workspace-composer-actions"><details className="case-workspace-quick-replies" ref={quickRepliesRef}><summary>Quick replies <span aria-hidden="true">⌃</span></summary><div className="case-workspace-quick-replies-menu">{COORDINATOR_QUICK_REPLIES.map((reply) => <button type="button" key={reply} onClick={() => { setDraft(reply); quickRepliesRef.current?.removeAttribute("open"); }}>{reply}</button>)}</div></details><button className="case-workspace-send" disabled={!draft.trim() || sending}>{sending ? "Sending…" : "Send Message →"}</button></div></form> : <p className="case-workspace-readonly">AI conversation is read-only for coordinators.</p>}
        </section>

        <aside className="case-workspace-side">
          {caseInfo && <section className="case-details-card">
            <header><h2><i>▤</i>Case Details</h2><small>ID: CASE-{id.slice(0, 8).toUpperCase()}</small></header>
            <div className="case-details-owner"><div><small>Case owner</small><strong>{caseInfo.assigneeNickname ?? "Unassigned"}</strong></div><div><small>Case age</small><strong>{caseAge(caseInfo.createdAt)}</strong></div></div>
            <div className="case-details-hotel"><i>▦</i><div><small>Hotel</small><strong>{caseInfo.hotelName ?? "—"}</strong></div></div>
            <dl className="case-details-core"><div><dt>Disruption</dt><dd>{caseInfo.disruptionTitle ?? "—"}</dd></div><div><dt>Stay dates</dt><dd>{caseInfo.checkIn && caseInfo.checkOut ? `${caseInfo.checkIn} – ${caseInfo.checkOut}` : "Not recorded"}</dd></div><div><dt>Priority</dt><dd><span className={`detail-pill priority ${caseInfo.priority}`}>{caseInfo.priority}</span></dd></div><div><dt>Status</dt><dd><span className={`detail-pill status ${caseInfo.status}`}>{statusTone(caseInfo.statusLabel)}</span></dd></div></dl>
            <EscalationReviewPanel caseInfo={caseInfo} />
            <div className="case-details-contact"><small>Guest contact & booking</small><div><span><b>{caseInfo.guestNickname ?? "Guest"}</b>{caseInfo.guestPhone ?? "No phone"}</span><span><b>Booking</b>{caseInfo.confirmationNo ?? "—"}</span><span><b>Email</b>{caseInfo.guestEmail ?? "—"}</span></div></div>
            <div className="case-details-tags">
              <small>Guest tags · staff only, the guest can&apos;t see these</small>
              {guestTags ? (
                guestTags.isHighValueGuest || guestTags.emotionallySensitive || guestTags.aiDifficult || guestTags.highRejectionRate || guestTags.slowResponder || guestTags.customTags.length > 0 ? (
                  <div className="case-details-tag-chips">
                    {guestTags.isHighValueGuest && <span className="tag tag-status-vip">high value</span>}
                    {guestTags.emotionallySensitive && <span className="case-tag-chip muted">emotionally sensitive</span>}
                    {guestTags.aiDifficult && <span className="case-tag-chip muted">AI difficult</span>}
                    {guestTags.highRejectionRate && <span className="case-tag-chip muted">high rejection</span>}
                    {guestTags.slowResponder && <span className="case-tag-chip muted">slow responder</span>}
                    {guestTags.customTags.map((t) => <span key={t.id} className="case-tag-chip">{t.label}</span>)}
                  </div>
                ) : <p className="case-workspace-empty">No tags recorded for this guest.</p>
              ) : <p className="case-workspace-empty">Loading tags…</p>}
            </div>
            <button className="case-options-action" disabled={caseInfo.status === "closed"} onClick={() => navigate(`/coordinator/cases/${id}/options`)}><span>▰</span>Review Rebooking Options <b>→</b></button>
          </section>}
          <section className="case-activity"><header><h2>Case Activity</h2><small>Latest recorded events</small></header>{activity.length === 0 ? <p className="case-workspace-empty">No recorded activity.</p> : <ol>{activity.map((item, index) => <li key={`${item.at}-${index}`}><i/><div><strong>{item.title}</strong><time>{new Date(item.at).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div></li>)}</ol>}</section>
        </aside>
      </div>
    </div>
  </CoordinatorDashboardShell>;
}
