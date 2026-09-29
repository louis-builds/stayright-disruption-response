import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { fetchMyCallAudits } from "../admin/api";
import type { RecordingAuditListItem } from "../admin/types";
import "../admin/RecordingAudit.css";
import { CoordinatorDashboardShell } from "./CoordinatorDashboardShell";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-NZ", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CallReviewsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<RecordingAuditListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchMyCallAudits(page, 20);
    if (res.code === 0) {
      setItems(res.data.list);
      setTotal(res.data.total);
      setTotalPages(Math.max(1, res.data.totalPages));
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  return (
    <CoordinatorDashboardShell
      user={user}
      active="reviews"
      onNavigate={(tab) => navigate("/coordinator/home", { state: { tab } })}
      onSearch={() => navigate("/coordinator/home", { state: { tab: "search" } })}
    >
      <div className="audit-page">
        <div className="audit-heading">
          <div>
            <span>Coaching</span>
            <h1>Call reviews</h1>
            <p>Admin scores and comments on your recorded calls. These stay here even after the notification is read.</p>
          </div>
          <b>{total} reviewed</b>
        </div>
        <section className="audit-card" style={{ marginTop: 16 }}>
          {loading ? (
            <p className="audit-loading">Loading reviews…</p>
          ) : items.length === 0 ? (
            <p className="audit-empty">No reviewed recordings yet. When an admin scores a call, it will appear here.</p>
          ) : (
            items.map((item) => {
              const open = openId === item.recordingId;
              return (
                <div key={item.recordingId}>
                  <button
                    type="button"
                    className={`audit-row${open ? " active" : ""}`}
                    onClick={() => setOpenId(open ? null : item.recordingId)}
                  >
                    <span>
                      <strong>{item.guestNickname ?? "Guest"} · {item.confirmationNo ?? "No booking no"}</strong>
                      <small>
                        {item.auditedByNickname ? `Reviewed by ${item.auditedByNickname}` : "Reviewed"}
                        {item.auditedAt ? ` · ${formatWhen(item.auditedAt)}` : ""}
                      </small>
                    </span>
                    <time>{formatWhen(item.startedAt)}</time>
                    <em className="audit-rating done">{item.auditRating ?? "—"}/5</em>
                  </button>
                  {open && (
                    <div className="audit-detail">
                      <div className="audit-block">
                        <h3>Comment</h3>
                        <p>{item.auditComment?.trim() || "No written comment."}</p>
                      </div>
                      <div className="audit-actions">
                        <button type="button" onClick={() => navigate(`/cases/${item.caseId}`)}>
                          Open case
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
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
      </div>
    </CoordinatorDashboardShell>
  );
}
