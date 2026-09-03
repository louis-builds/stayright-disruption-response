import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { useCaseConversation } from "../cases/useCaseConversation";
import type { Thread } from "../cases/types";
import { CoordinatorDashboardShell } from "./CoordinatorDashboardShell";
import "./CoordinatorCaseWorkspacePage.css";

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
  const { caseInfo, messages, loading, sending, error, sendMessage } = useCaseConversation(id, "coordinator", thread);

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
          {thread === "coordinator" ? <form onSubmit={submit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message to the guest…"/><button disabled={!draft.trim() || sending}>{sending ? "Sending…" : "Send Message →"}</button></form> : <p className="case-workspace-readonly">AI conversation is read-only for coordinators.</p>}
        </section>

        <aside className="case-workspace-side">
          {caseInfo && <section className="case-details-card">
            <header><h2><i>▤</i>Case Details</h2><small>ID: CASE-{id.slice(0, 8).toUpperCase()}</small></header>
            <div className="case-details-owner"><div><small>Case owner</small><strong>{caseInfo.assigneeNickname ?? "Unassigned"}</strong></div><div><small>Case age</small><strong>{caseAge(caseInfo.createdAt)}</strong></div></div>
            <div className="case-details-hotel"><i>▦</i><div><small>Hotel</small><strong>{caseInfo.hotelName ?? "—"}</strong></div></div>
            <dl className="case-details-core"><div><dt>Disruption</dt><dd>{caseInfo.disruptionTitle ?? "—"}</dd></div><div><dt>Stay dates</dt><dd>{caseInfo.checkIn && caseInfo.checkOut ? `${caseInfo.checkIn} – ${caseInfo.checkOut}` : "Not recorded"}</dd></div><div><dt>Priority</dt><dd><span className={`detail-pill priority ${caseInfo.priority}`}>{caseInfo.priority}</span></dd></div><div><dt>Status</dt><dd><span className={`detail-pill status ${caseInfo.status}`}>{statusTone(caseInfo.statusLabel)}</span></dd></div></dl>
            <div className="case-details-contact"><small>Guest contact & booking</small><div><span><b>{caseInfo.guestNickname ?? "Guest"}</b>{caseInfo.guestPhone ?? "No phone"}</span><span><b>Booking</b>{caseInfo.confirmationNo ?? "—"}</span><span><b>Email</b>{caseInfo.guestEmail ?? "—"}</span></div></div>
            <button className="case-options-action" disabled={caseInfo.status === "closed"} onClick={() => navigate(`/coordinator/cases/${id}/options`)}><span>▰</span>Review Rebooking Options <b>→</b></button>
          </section>}
          <section className="case-activity"><header><h2>Case Activity</h2><small>Latest recorded events</small></header>{activity.length === 0 ? <p className="case-workspace-empty">No recorded activity.</p> : <ol>{activity.map((item, index) => <li key={`${item.at}-${index}`}><i/><div><strong>{item.title}</strong><time>{new Date(item.at).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time></div></li>)}</ol>}</section>
        </aside>
      </div>
    </div>
  </CoordinatorDashboardShell>;
}
