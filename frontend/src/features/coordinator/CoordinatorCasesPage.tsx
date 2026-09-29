import { useEffect, useMemo, useState } from "react";
import { useMobileLayout } from "../../shared/layout/MobileLayoutProvider";
import * as api from "./api";
import type { CaseQueueItem, CoordinatorOption } from "./types";
import "./CoordinatorCasesPage.css";

function formatAge(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  const dayParts = hours.split(".");
  const totalHours = Number(dayParts.at(-1)) + (dayParts.length > 1 ? Number(dayParts[0]) * 24 : 0);
  return totalHours >= 24 ? `${Math.floor(totalHours / 24)}d ${totalHours % 24}h` : `${totalHours}h ${Number(minutes)}m`;
}
function interventionLabel(value: string) {
  return ({ "AI没把握": "AI confidence too low", "客人拒绝全部方案": "Guest rejected all options" } as Record<string, string>)[value] ?? value;
}

export function CoordinatorCasesPage({ initialQuery, initialView, initialDisruptionFilter, currentUserId, onOpenCase, onEscalate }: { initialQuery: string; initialView: "active" | "mine"; initialDisruptionFilter: { id: string; title: string } | null; currentUserId: string; onOpenCase: (id: string) => void; onEscalate: (id: string) => void }) {
  const isMobile = useMobileLayout();
  const [items, setItems] = useState<CaseQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(initialQuery);
  const [view, setView] = useState<"active" | "attention" | "mine" | "resolved">(initialView);
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [intervention, setIntervention] = useState("all");
  const [page, setPage] = useState(1);
  const [coordinators, setCoordinators] = useState<CoordinatorOption[]>([]);
  const [transferTarget, setTransferTarget] = useState<CaseQueueItem | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [disruptionFilter, setDisruptionFilter] = useState(initialDisruptionFilter);
  const [disruptionCaseIds, setDisruptionCaseIds] = useState<Set<string> | null>(null);

  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => {
    setDisruptionFilter(initialDisruptionFilter);
    if (!initialDisruptionFilter) { setDisruptionCaseIds(null); return; }
    void api.fetchDisruptionCases(initialDisruptionFilter.id).then((response) => {
      setDisruptionCaseIds(response.code === 0 ? new Set(response.data.map((item) => item.caseId)) : new Set());
    });
  }, [initialDisruptionFilter]);
  useEffect(() => {
    const load = () => void api.search("").then((response) => {
      if (response.code === 0) {
        setItems(response.data);
        setSyncedAt(new Date());
      }
      setLoading(false);
    });
    load();
    const timer = window.setInterval(load, 30_000);
    void api.fetchCoordinators().then((response) => {
      if (response.code === 0) setCoordinators(response.data);
    });
    return () => window.clearInterval(timer);
  }, []);

  function beginTransfer(item: CaseQueueItem) {
    const firstAvailable = coordinators.find((coordinator) => coordinator.nickname !== item.assigneeNickname);
    setTransferTarget(item);
    setTransferTo(firstAvailable?.id ?? "");
    setTransferError("");
  }

  async function confirmTransfer() {
    if (!transferTarget || !transferTo) return;
    setTransferring(true);
    setTransferError("");
    const response = await api.transferCase(transferTarget.caseId, transferTo);
    if (response.code === 0) {
      const owner = coordinators.find((coordinator) => coordinator.id === transferTo)?.nickname ?? "Assigned";
      setItems((current) => current.map((item) => item.caseId === transferTarget.caseId ? { ...item, assigneeNickname: owner } : item));
      setTransferTarget(null);
    } else {
      setTransferError(response.message || "The case could not be transferred.");
    }
    setTransferring(false);
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (view === "active" && item.status === "closed") return false;
      if (view === "attention" && (item.status === "closed" || !(item.escalationReason || item.overdue || item.isHighValueGuest))) return false;
      if (view === "mine" && (item.status === "closed" || item.assigneeCoordinatorId !== currentUserId)) return false;
      if (view === "resolved" && item.status !== "closed") return false;
      if (status === "awaiting_hotel" && !item.awaitingHotelConfirmation) return false;
      if (status !== "all" && status !== "awaiting_hotel" && item.status !== status) return false;
      if (priority !== "all" && item.priority !== priority) return false;
      if (intervention !== "all" && item.escalationReason !== intervention) return false;
      if (disruptionFilter && (!disruptionCaseIds || !disruptionCaseIds.has(item.caseId))) return false;
      if (!needle) return true;
      return [item.confirmationNo, item.guestNickname, item.disruptionTitle, item.assigneeNickname ?? ""]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [currentUserId, disruptionCaseIds, disruptionFilter, intervention, items, priority, query, status, view]);

  useEffect(() => setPage(1), [query, status, priority, intervention, view]);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const counts = {
    all: items.length,
    active: items.filter((item) => item.status !== "closed").length,
    pending: items.filter((item) => item.status === "pending").length,
    progress: items.filter((item) => item.status === "in_progress").length,
    closed: items.filter((item) => item.status === "closed").length,
    attention: items.filter((item) => item.status !== "closed" && (item.escalationReason || item.overdue || item.isHighValueGuest)).length,
    overdue: items.filter((item) => item.status !== "closed" && item.overdue).length,
    highValue: items.filter((item) => item.status !== "closed" && item.isHighValueGuest).length,
    mine: items.filter((item) => item.status !== "closed" && item.assigneeCoordinatorId === currentUserId).length,
  };
  const interventionReasons = Array.from(new Set(items.map((item) => item.escalationReason).filter((value): value is string => Boolean(value))));
  const selectView = (next: "active" | "attention" | "mine" | "resolved") => {
    setView(next);
    setStatus("all");
    setIntervention("all");
  };

  return <div className="cases-page">
    {isMobile ? (
      <nav className="m-section-tabs" aria-label="Case views">
        <button type="button" className={view === "active" ? "active" : ""} onClick={() => selectView("active")}>Active</button>
        <button type="button" className={view === "attention" ? "active" : ""} onClick={() => selectView("attention")}>Alert</button>
        <button type="button" className={view === "mine" ? "active" : ""} onClick={() => selectView("mine")}>Mine</button>
        <button type="button" className={view === "resolved" ? "active" : ""} onClick={() => selectView("resolved")}>Closed</button>
      </nav>
    ) : (
      <>
    <header className="cases-heading"><div><span>Case workspace</span><h1>{view === "resolved" ? "Resolved History" : view === "attention" ? "Cases Needing Attention" : view === "mine" ? "My Active Cases" : "Active Cases"}</h1><p>{view === "resolved" ? "Review completed cases and their recorded outcomes." : view === "mine" ? "Open cases currently assigned to you." : "Manage cases that still require coordinator action."}</p></div><b>{filtered.length} records</b></header>
    <section className="cases-summary">
      <button className={view === "active" ? "active" : ""} onClick={() => selectView("active")}><span>Active cases</span><strong>{counts.active}</strong><small>{counts.pending} pending · {counts.progress} in progress</small></button>
      <button className={view === "attention" ? "active" : ""} onClick={() => selectView("attention")}><span>Needs attention</span><strong>{counts.attention}</strong><small>{counts.overdue} overdue · {counts.highValue} high-value</small></button>
      <button className={view === "mine" ? "active" : ""} onClick={() => selectView("mine")}><span>My active cases</span><strong>{counts.mine}</strong><small>Assigned to the current coordinator</small></button>
      <button className={view === "resolved" ? "active" : ""} onClick={() => selectView("resolved")}><span>Resolved history</span><strong>{counts.closed}</strong><small>Completed and archived cases</small></button>
    </section>
      </>
    )}
    <section className="cases-card">
      {disruptionFilter && <div className="cases-applied-filter"><span>Filtered by disruption</span><strong>{disruptionFilter.title}</strong><button onClick={() => { setDisruptionFilter(null); setDisruptionCaseIds(null); }}>×</button></div>}
      {!isMobile && <div className="cases-toolbar"><div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search booking, guest, disruption or owner"/><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="awaiting_hotel">Awaiting hotel</option><option value="closed">Closed</option></select><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All priorities</option><option value="high">High priority</option><option value="normal">Normal priority</option></select><select value={intervention} onChange={(event) => setIntervention(event.target.value)}><option value="all">All intervention reasons</option>{interventionReasons.map((reason) => <option key={reason} value={reason}>{interventionLabel(reason)}</option>)}</select></div><span><b>{counts.overdue}</b> overdue · <b>{counts.highValue}</b> high-value{syncedAt && <> · Synced {syncedAt.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}</>}</span></div>}
      <div className="cases-table-head"><span>Case / booking</span><span>Guest</span><span>Disruption</span><span>Status</span><span>Priority</span><span>Owner</span><span>Age / resolution</span><span>Actions</span></div>
      {loading ? <p className="cases-empty">Loading cases…</p> : visible.length === 0 ? <p className="cases-empty">No cases match these filters.</p> : <div className="cases-table-body">{visible.map((item) => <div className="cases-row" key={item.caseId}><span><b>{item.confirmationNo || `CASE-${item.caseId.slice(0, 6).toUpperCase()}`}</b><small>{item.caseId.slice(0, 8)}</small></span><strong>{item.guestNickname}</strong><span>{item.disruptionTitle}</span><em className={`status ${item.awaitingHotelConfirmation ? "awaiting_hotel" : item.status}`}>{item.awaitingHotelConfirmation ? "awaiting hotel" : item.status.replaceAll("_", " ")}</em><em className={`priority ${item.priority}`}>{item.priority}</em><span>{item.assigneeNickname ?? "Unassigned"}</span><time>{formatAge(item.waitTime)}</time><div className="cases-actions"><button onClick={() => onOpenCase(item.caseId)}>{item.status === "closed" ? "View history" : "Open"}</button>{item.status !== "closed" && <><button className="transfer" onClick={() => beginTransfer(item)}>Transfer</button>{item.awaitingHotelConfirmation ? <button className="escalate" disabled>Awaiting hotel</button> : <button className="escalate" onClick={() => onEscalate(item.caseId)}>Resolve</button>}</>}</div></div>)}</div>}
      <footer className="cases-pagination"><span>Page {safePage} of {totalPages}</span><div><button disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Previous</button><button disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next</button></div></footer>
    </section>
    {transferTarget && <div className="cases-modal-backdrop" role="presentation" onMouseDown={() => !transferring && setTransferTarget(null)}><section className="cases-transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title" onMouseDown={(event) => event.stopPropagation()}><header><span>⇄</span><div><small>Reassign case</small><h2 id="transfer-title">Transfer ownership</h2></div><button aria-label="Close" onClick={() => setTransferTarget(null)}>×</button></header><div className="transfer-case-summary"><span><small>Case</small><strong>{transferTarget.confirmationNo}</strong></span><span><small>Guest</small><strong>{transferTarget.guestNickname}</strong></span><span><small>Current owner</small><strong>{transferTarget.assigneeNickname ?? "Unassigned"}</strong></span></div><label><span>New coordinator</span><select value={transferTo} onChange={(event) => setTransferTo(event.target.value)}><option value="">Select a coordinator</option>{coordinators.filter((coordinator) => coordinator.nickname !== transferTarget.assigneeNickname).map((coordinator) => <option key={coordinator.id} value={coordinator.id}>{coordinator.nickname}</option>)}</select><small>The selected coordinator will become responsible for this case.</small></label>{transferError && <p className="transfer-error">{transferError}</p>}<footer><button onClick={() => setTransferTarget(null)} disabled={transferring}>Cancel</button><button className="confirm" onClick={() => void confirmTransfer()} disabled={!transferTo || transferring}>{transferring ? "Transferring…" : "Confirm transfer"}</button></footer></section></div>}
  </div>;
}
