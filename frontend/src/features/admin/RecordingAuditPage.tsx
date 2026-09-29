import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE } from "../../shared/api/client";
import { fetchAdminUsers } from "../coordinator/api";
import type { AdminUser } from "../coordinator/types";
import * as api from "./api";
import "./RecordingAudit.css";
import type { RecordingAuditDetail, RecordingAuditListItem } from "./types";

function mediaUrl(fileUrl: string) {
  if (/^https?:/i.test(fileUrl)) return fileUrl;
  return `${API_BASE}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-NZ", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RecordingAuditPage({ searchQuery = "" }: { searchQuery?: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(searchQuery);
  const [auditStatus, setAuditStatus] = useState("");
  const [coordinatorId, setCoordinatorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [items, setItems] = useState<RecordingAuditListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [coordinators, setCoordinators] = useState<AdminUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecordingAuditDetail | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setQ(searchQuery), [searchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.fetchRecordingsForAudit({
      page,
      q,
      coordinatorId: coordinatorId || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      auditStatus: auditStatus || undefined,
    });
    if (res.code === 0) {
      setItems(res.data.list);
      setTotal(res.data.total);
      setTotalPages(Math.max(1, res.data.totalPages));
    }
    setLoading(false);
  }, [page, q, coordinatorId, from, to, auditStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [q, coordinatorId, from, to, auditStatus]);

  useEffect(() => {
    void fetchAdminUsers().then((res) => {
      if (res.code === 0) setCoordinators(res.data.filter((u) => u.role === "coordinator"));
    });
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void api.fetchRecordingForAudit(selectedId).then((res) => {
      if (res.code === 0) {
        setDetail(res.data);
        setRating(res.data.auditRating ?? 0);
        setComment(res.data.auditComment ?? "");
        setError(null);
        setSaved(false);
      } else {
        setError(res.message || "Recording not found");
      }
    });
  }, [selectedId]);

  async function submit() {
    if (!selectedId || rating < 1) return;
    setSaving(true);
    setError(null);
    const res = await api.submitRecordingAudit(selectedId, rating, comment);
    setSaving(false);
    if (res.code !== 0) {
      setError(res.message || "Could not save the review");
      return;
    }
    setDetail(res.data);
    setSaved(true);
    await load();
  }

  return (
    <div className="audit-page">
      <div className="audit-heading">
        <div>
          <span>Quality review</span>
          <h1>Recording audit</h1>
          <p>Search calls, listen back, and rate the coordinator. They are notified, and the score stays on their reviews page.</p>
        </div>
        <b>{total} recordings</b>
      </div>
      <div className="audit-layout">
        <section className="audit-card">
          <div className="audit-toolbar">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Guest, booking no, coordinator"
            />
            <select value={auditStatus} onChange={(e) => setAuditStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending review</option>
              <option value="done">Reviewed</option>
            </select>
            <select value={coordinatorId} onChange={(e) => setCoordinatorId(e.target.value)}>
              <option value="">All coordinators</option>
              {coordinators.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nickname}
                </option>
              ))}
            </select>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {loading ? (
            <p className="audit-loading">Loading recordings…</p>
          ) : items.length === 0 ? (
            <p className="audit-empty">No recordings match this search.</p>
          ) : (
            items.map((item) => (
              <button
                key={item.recordingId}
                type="button"
                className={`audit-row${selectedId === item.callId ? " active" : ""}`}
                onClick={() => setSelectedId(item.callId)}
              >
                <span>
                  <strong>{item.guestNickname ?? "Guest"} · {item.confirmationNo ?? "No booking no"}</strong>
                  <small>
                    {item.coordinatorNickname} · {formatDuration(item.durationSeconds)}
                    {item.auditedAt ? "" : " · awaiting review"}
                  </small>
                </span>
                <time>{formatWhen(item.startedAt)}</time>
                <em className={`audit-rating${item.auditRating ? " done" : ""}`}>
                  {item.auditRating ? `${item.auditRating}/5` : "Pending"}
                </em>
              </button>
            ))
          )}
          <div className="audit-pagination">
            <span>
              Page {page} / {totalPages}
            </span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        </section>
        <aside className="audit-card audit-detail">
          {!detail ? (
            <p className="audit-empty">Select a recording to listen and score it.</p>
          ) : (
            <>
              <h2>{detail.guestNickname ?? "Guest"}</h2>
              <p>
                {detail.confirmationNo ?? "No confirmation"} · {detail.coordinatorNickname} · {formatWhen(detail.startedAt)}
              </p>
              <div className="audit-meta">
                <span>
                  <small>Duration</small>
                  <strong>{formatDuration(detail.durationSeconds)}</strong>
                </span>
                <span>
                  <small>Processing</small>
                  <strong>{detail.processingStatus}</strong>
                </span>
                <span>
                  <small>Last reviewed</small>
                  <strong>{detail.auditedAt ? formatWhen(detail.auditedAt) : "Not yet"}</strong>
                </span>
                <span>
                  <small>Reviewed by</small>
                  <strong>{detail.auditedByNickname ?? "—"}</strong>
                </span>
              </div>
              <audio controls src={mediaUrl(detail.fileUrl)} preload="none" />
              {detail.aiSummary && (
                <div className="audit-block">
                  <h3>AI summary</h3>
                  <p>{detail.aiSummary}</p>
                </div>
              )}
              {detail.transcriptText && (
                <div className="audit-block">
                  <h3>Transcript</h3>
                  <p>{detail.transcriptText}</p>
                </div>
              )}
              {detail.coordinatorNote && (
                <div className="audit-block">
                  <h3>Coordinator note</h3>
                  <p>{detail.coordinatorNote}</p>
                </div>
              )}
              <div className="audit-block">
                <h3>Score</h3>
                <div className="audit-stars">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" className={rating >= n ? "on" : ""} onClick={() => setRating(n)}>
                      {n}
                    </button>
                  ))}
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="What went well, and what should change next time?"
                />
              </div>
              {error && <p className="audit-error">{error}</p>}
              {saved && <p className="audit-saved">Saved. The coordinator has been notified.</p>}
              <div className="audit-actions">
                <button type="button" className="audit-open-case" onClick={() => navigate(`/cases/${detail.caseId}`)}>
                  Open case
                </button>
                <button type="button" className="primary" disabled={rating < 1 || saving} onClick={() => void submit()}>
                  {saving ? "Saving…" : "Save review"}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
