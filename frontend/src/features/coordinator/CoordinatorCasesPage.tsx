import { useEffect, useMemo, useState } from "react";
import * as api from "./api";
import type { CaseQueueItem } from "./types";
import "./CoordinatorCasesPage.css";

function formatAge(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  const dayParts = hours.split(".");
  const totalHours = Number(dayParts.at(-1)) + (dayParts.length > 1 ? Number(dayParts[0]) * 24 : 0);
  return totalHours >= 24 ? `${Math.floor(totalHours / 24)}d ${totalHours % 24}h` : `${totalHours}h ${Number(minutes)}m`;
}

export function CoordinatorCasesPage({ initialQuery, onOpenCase }: { initialQuery: string; onOpenCase: (id: string) => void }) {
  const [items, setItems] = useState<CaseQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => {
    void api.search("").then((response) => {
      setItems(response.code === 0 ? response.data : []);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (priority !== "all" && item.priority !== priority) return false;
      if (!needle) return true;
      return [item.confirmationNo, item.guestNickname, item.disruptionTitle, item.assigneeNickname ?? ""]
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [items, priority, query, status]);

  useEffect(() => setPage(1), [query, status, priority]);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const counts = {
    all: items.length,
    open: items.filter((item) => item.status !== "closed").length,
    pending: items.filter((item) => item.status === "pending").length,
    progress: items.filter((item) => item.status === "in_progress").length,
    closed: items.filter((item) => item.status === "closed").length,
  };

  return <div className="cases-page">
    <header className="cases-heading"><div><span>Case records</span><h1>All Cases</h1><p>Review every open case and completed case history in one place.</p></div><b>{counts.all} total records</b></header>
    <section className="cases-summary">
      <button className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}><span>All cases</span><strong>{counts.all}</strong></button>
      <button className={status === "pending" ? "active" : ""} onClick={() => setStatus("pending")}><span>Pending</span><strong>{counts.pending}</strong></button>
      <button className={status === "in_progress" ? "active" : ""} onClick={() => setStatus("in_progress")}><span>In progress</span><strong>{counts.progress}</strong></button>
      <button className={status === "closed" ? "active" : ""} onClick={() => setStatus("closed")}><span>Closed history</span><strong>{counts.closed}</strong></button>
    </section>
    <section className="cases-card">
      <div className="cases-toolbar"><div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search booking, guest, disruption or owner"/><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All priorities</option><option value="high">High priority</option><option value="normal">Normal priority</option></select></div><span>{filtered.length} matching cases</span></div>
      <div className="cases-table-head"><span>Case / booking</span><span>Guest</span><span>Disruption</span><span>Status</span><span>Priority</span><span>Owner</span><span>Age / resolution</span><span>Action</span></div>
      {loading ? <p className="cases-empty">Loading cases…</p> : visible.length === 0 ? <p className="cases-empty">No cases match these filters.</p> : <div className="cases-table-body">{visible.map((item) => <div className="cases-row" key={item.caseId}><span><b>{item.confirmationNo || `CASE-${item.caseId.slice(0, 6).toUpperCase()}`}</b><small>{item.caseId.slice(0, 8)}</small></span><strong>{item.guestNickname}</strong><span>{item.disruptionTitle}</span><em className={`status ${item.status}`}>{item.status.replaceAll("_", " ")}</em><em className={`priority ${item.priority}`}>{item.priority}</em><span>{item.assigneeNickname ?? "Unassigned"}</span><time>{formatAge(item.waitTime)}</time><button onClick={() => onOpenCase(item.caseId)}>{item.status === "closed" ? "View history" : "Open case"}</button></div>)}</div>}
      <footer className="cases-pagination"><span>Page {safePage} of {totalPages}</span><div><button disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Previous</button><button disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next</button></div></footer>
    </section>
  </div>;
}
