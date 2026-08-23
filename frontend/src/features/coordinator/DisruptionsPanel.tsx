import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "./api";
import { escalationReasonLabel } from "./escalationLabels";
import type { CandidateBooking, CaseQueueItem, CoordinatorOption, DisruptionDetail, DisruptionListItem } from "./types";

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "weather", label: "Weather" },
  { value: "flight", label: "Flight" },
  { value: "road", label: "Road" },
];

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ExcludeModal({ candidate, onCancel, onConfirm }: {
  candidate: CandidateBooking; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Exclude {candidate.confirmationNo}</h3>
        <p className="coord-modal-hint">Mark this booking as not actually affected by this disruption.</p>
        <label className="coord-field">
          <span>Reason</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. booking is for a different area" />
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Confirm exclude
          </button>
        </div>
      </div>
    </div>
  );
}

interface DetailPanelProps {
  disruption: DisruptionDetail;
  coordinators: CoordinatorOption[];
  onChanged: () => void;
}

const CANDIDATES_PAGE_SIZE = 10;

function DetailPanel({ disruption, coordinators, onChanged }: DetailPanelProps) {
  const navigate = useNavigate();
  const [detailTab, setDetailTab] = useState<"details" | "notify">("details");
  const [candidates, setCandidates] = useState<CandidateBooking[]>([]);
  const [affectedCases, setAffectedCases] = useState<CaseQueueItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priority, setPriority] = useState("normal");
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [start, setStart] = useState(toLocalInput(disruption.startAt));
  const [end, setEnd] = useState(toLocalInput(disruption.endAtOrWindow));
  const [assignTo, setAssignTo] = useState(disruption.assigneeCoordinatorId ?? coordinators[0]?.id ?? "");
  const [excludeTarget, setExcludeTarget] = useState<CandidateBooking | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const prevDisruptionIdRef = useRef<string | null>(null);

  const loadCandidates = useCallback(async () => {
    setLoadingCandidates(true);
    const res = await api.fetchCandidates(disruption.id);
    if (res.code === 0) {
      setCandidates(res.data);
      // 之前不管三七二十一每次都 new Set() 清空勾选——但这个函数不仅在真的切换到另一个
      // 中断事件时会跑，改恢复窗口/改责任人这些跟候选人无关的保存动作也会触发它（因为
      // 那些操作会让 disruption 这个 prop 换个引用）。协调员在 Notify tab 勾好人，顺手去
      // Details tab 存了个别的字段，回来发现刚勾的人全没了。换成只在真的换了另一个中断
      // 事件时才清空；同一个事件刷新的话，只把已经不在新候选列表里的选项过滤掉（比如
      // 窗口改了导致某人不再符合条件），其余保留。
      const isDifferentDisruption = prevDisruptionIdRef.current !== disruption.id;
      if (isDifferentDisruption) {
        setSelected(new Set());
      } else {
        const stillValidIds = new Set(res.data.map((c) => c.bookingId));
        setSelected((prev) => new Set([...prev].filter((id) => stillValidIds.has(id))));
      }
      prevDisruptionIdRef.current = disruption.id;
    }
    setCandidatePage(1);
    setLoadingCandidates(false);
  }, [disruption.id]);

  useEffect(() => {
    void loadCandidates();
    setStart(toLocalInput(disruption.startAt));
    setEnd(toLocalInput(disruption.endAtOrWindow));
    setAssignTo(disruption.assigneeCoordinatorId ?? coordinators[0]?.id ?? "");
    setAffectedCases(null);
    void api.fetchDisruptionCases(disruption.id).then((res) => {
      if (res.code === 0) setAffectedCases(res.data);
    });
  }, [disruption, loadCandidates, coordinators]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveWindow() {
    await api.adjustWindow(disruption.id, new Date(start).toISOString(), end ? new Date(end).toISOString() : null);
    onChanged();
  }

  async function saveAssignee() {
    if (!assignTo) return;
    await api.assignDisruption(disruption.id, assignTo);
    onChanged();
  }

  async function resolve() {
    await api.resolveDisruption(disruption.id);
    onChanged();
  }

  async function confirmExclude(reason: string) {
    if (!excludeTarget) return;
    await api.excludeCandidate(disruption.id, excludeTarget.bookingId, reason);
    setExcludeTarget(null);
    await loadCandidates();
  }

  async function notifySelected() {
    if (selected.size === 0) return;
    setNotifying(true);
    await api.notifyCandidates(disruption.id, [...selected], priority);
    setNotifying(false);
    await loadCandidates();
    onChanged();
  }

  const filteredCandidates = candidates.filter((c) => {
    const q = candidateQuery.trim().toLowerCase();
    if (!q) return true;
    return c.confirmationNo.toLowerCase().includes(q) || c.guestNickname.toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filteredCandidates.length / CANDIDATES_PAGE_SIZE));
  const pageSafe = Math.min(candidatePage, totalPages);
  const pagedCandidates = filteredCandidates.slice((pageSafe - 1) * CANDIDATES_PAGE_SIZE, pageSafe * CANDIDATES_PAGE_SIZE);

  return (
    <div className="coord-disruption-detail">
      <div className="coord-detail-header">
        <div>
          <h3>{disruption.title}</h3>
          <p className="coord-row-sub">
            {disruption.type} · {disruption.region} · {disruption.affectedCount} affected cases
          </p>
        </div>
        {disruption.status === "active" && (
          <button type="button" className="coord-btn-primary" onClick={() => void resolve()}>
            Mark resolved
          </button>
        )}
      </div>

      <div className="coord-tabs">
        <button type="button" className={`coord-tab ${detailTab === "details" ? "coord-tab-active" : ""}`} onClick={() => setDetailTab("details")}>
          Details
        </button>
        <button type="button" className={`coord-tab ${detailTab === "notify" ? "coord-tab-active" : ""}`} onClick={() => setDetailTab("notify")}>
          Notify guests {candidates.length > 0 ? `(${candidates.length})` : ""}
        </button>
      </div>

      {detailTab === "details" ? (
        <>
          <div className="coord-detail-section">
            <h4>Signal</h4>
            <p className="coord-signal-text">{disruption.rawSignalText}</p>
          </div>

          <div className="coord-detail-section coord-detail-grid">
            <div>
              <h4>Recovery window</h4>
              <label className="coord-field">
                <span>Start</span>
                <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="coord-field">
                <span>End (optional)</span>
                <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
              <button type="button" className="coord-btn-secondary" onClick={() => void saveWindow()}>
                Save window
              </button>
            </div>
            <div>
              <h4>Assigned coordinator</h4>
              <label className="coord-field">
                <span>Owner</span>
                <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                  {coordinators.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nickname}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="coord-btn-secondary" onClick={() => void saveAssignee()}>
                Save owner
              </button>
            </div>
          </div>

          <div className="coord-detail-section">
            <h4>Affected cases {affectedCases ? `(${affectedCases.length})` : ""}</h4>
            {affectedCases === null ? (
              <p className="coord-empty">Loading…</p>
            ) : affectedCases.length === 0 ? (
              <p className="coord-empty">No cases opened for this disruption yet.</p>
            ) : (
              <div className="coord-table">
                {affectedCases.map((c) => (
                  <div key={c.caseId} className="coord-row">
                    <div className="coord-row-main">
                      <div className="coord-row-title">
                        <span className="coord-row-conf">{c.confirmationNo}</span>
                        <span className={`tag tag-status-${c.priority === "high" ? "warn" : "normal"}`}>{c.priority}</span>
                        {c.overdue && <span className="tag tag-status-overdue">overdue</span>}
                      </div>
                      <p className="coord-row-sub">
                        {c.guestNickname}
                        {c.escalationReason && ` · ${escalationReasonLabel(c.escalationReason)}`}
                      </p>
                    </div>
                    <button type="button" className="coord-btn-link" onClick={() => navigate(`/cases/${c.caseId}`)}>
                      Open conversation
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="coord-detail-section">
          {loadingCandidates ? (
            <p className="coord-empty">Loading…</p>
          ) : candidates.length === 0 ? (
            <p className="coord-empty">No unmatched bookings right now.</p>
          ) : (
            <>
              <div className="coord-toolbar">
                <input
                  className="coord-search-input"
                  placeholder="Search by confirmation no / guest name"
                  value={candidateQuery}
                  onChange={(e) => {
                    setCandidateQuery(e.target.value);
                    setCandidatePage(1);
                  }}
                />
              </div>
              {filteredCandidates.length === 0 ? (
                <p className="coord-empty">No matches.</p>
              ) : (
                <div className="coord-candidate-list">
                  {pagedCandidates.map((c) => (
                    <label key={c.bookingId} className="coord-candidate-row">
                      <input type="checkbox" checked={selected.has(c.bookingId)} onChange={() => toggle(c.bookingId)} />
                      <span className="coord-row-conf">{c.confirmationNo}</span>
                      {c.isHighValueGuest && <span className="tag tag-status-vip">returning guest</span>}
                      <span className="coord-row-sub">
                        {c.guestNickname} · {c.hotelName} · {c.checkIn} → {c.checkOut}
                      </span>
                      <button
                        type="button"
                        className="coord-btn-link coord-btn-danger"
                        onClick={(e) => {
                          e.preventDefault();
                          setExcludeTarget(c);
                        }}
                      >
                        Exclude
                      </button>
                    </label>
                  ))}
                </div>
              )}
              {totalPages > 1 && (
                <div className="coord-toolbar">
                  <button type="button" className="coord-btn-secondary" disabled={pageSafe <= 1} onClick={() => setCandidatePage(pageSafe - 1)}>
                    Previous
                  </button>
                  <span className="coord-row-meta">Page {pageSafe} / {totalPages}</span>
                  <button type="button" className="coord-btn-secondary" disabled={pageSafe >= totalPages} onClick={() => setCandidatePage(pageSafe + 1)}>
                    Next
                  </button>
                </div>
              )}
              <div className="coord-toolbar">
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="normal">Normal priority</option>
                  <option value="high">High priority (high-value / near check-in)</option>
                </select>
                <button type="button" className="coord-btn-primary" disabled={selected.size === 0 || notifying} onClick={() => void notifySelected()}>
                  {notifying ? "Notifying…" : `Notify ${selected.size || ""} selected guest${selected.size === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {excludeTarget && (
        <ExcludeModal candidate={excludeTarget} onCancel={() => setExcludeTarget(null)} onConfirm={(r) => void confirmExclude(r)} />
      )}
    </div>
  );
}

export function DisruptionsPanel({ coordinators }: { coordinators: CoordinatorOption[] }) {
  const [items, setItems] = useState<DisruptionListItem[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DisruptionDetail | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    const res = await api.fetchDisruptions(typeFilter || undefined);
    if (res.code === 0) {
      setItems(res.data);
      setSyncedAt(new Date());
      // loadList 只在 typeFilter 变化时才重新创建(见依赖数组),中间任何一次 refreshAll()
      // (改恢复窗口/改责任人/剔除候选/通知客人/结案)都会复用同一个闭包——如果这里直接读
      // selectedId 变量,拿到的永远是这个闭包创建那一刻(通常是挂载时,还是 null)的旧值,
      // 导致协调员正在查看非列表第一条的中断事件时,做任何保存动作都会被无声地弹回第一条。
      // 用函数式更新读当下最新值,只在真的还没选过时才兜底选第一条。
      if (res.data.length > 0) setSelectedId((prev) => prev ?? res.data[0].id);
    }
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // 中断事件列表之前只在筛选条件变化时拉一次，别的协调员新增/解决事件不会自己冒出来——
  // 静默轮询，不摸 loading，跟 Dashboard 概览同一套 30s 节奏。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.fetchDisruptions(typeFilter || undefined).then((res) => {
        if (res.code === 0) {
          setItems(res.data);
          setSyncedAt(new Date());
        }
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [typeFilter]);

  const stats = useMemo(() => {
    const active = items.filter((d) => d.status === "active").length;
    const totalAffected = items.reduce((sum, d) => sum + d.affectedCount, 0);
    return { active, totalAffected };
  }, [items]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const res = await api.fetchDisruption(selectedId);
    if (res.code === 0) setDetail(res.data);
  }, [selectedId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  async function refreshAll() {
    await loadList();
    await loadDetail();
  }

  return (
    <div className="coord-disruptions-page">
      <div className="coord-disruptions-stats">
        <div className="coord-stat-card">
          <span className="coord-stat-label">Active disruptions</span>
          <span className="coord-stat-value">{stats.active}</span>
        </div>
        <div className="coord-stat-card">
          <span className="coord-stat-label">Total affected cases</span>
          <span className="coord-stat-value">{stats.totalAffected}</span>
        </div>
        {syncedAt && (
          <p className="coord-sync-indicator coord-disruptions-sync">
            <span className="coord-sync-dot" aria-hidden="true" />
            Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
          </p>
        )}
      </div>
    <div className="coord-disruptions">
      <div className="coord-disruption-list">
        <div className="coord-toolbar">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            {TYPE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p className="coord-empty">Loading…</p>
        ) : items.length === 0 ? (
          <p className="coord-empty">No disruptions.</p>
        ) : (
          <div className="coord-table">
            {items.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`coord-disruption-row ${d.id === selectedId ? "coord-disruption-row-active" : ""}`}
                onClick={() => setSelectedId(d.id)}
              >
                <div className="coord-row-title">
                  <span className="coord-row-conf">{d.title}</span>
                  <span className={`tag tag-status-${d.status === "active" ? "warn" : "normal"}`}>{d.status}</span>
                </div>
                <p className="coord-row-sub">
                  {d.type} · {d.region} · {d.affectedCount} affected
                </p>
                <p className="coord-row-meta">{d.assigneeNickname ? `owner: ${d.assigneeNickname}` : "unassigned"}</p>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="coord-disruption-detail-wrap">
        {detail ? (
          <DetailPanel disruption={detail} coordinators={coordinators} onChanged={() => void refreshAll()} />
        ) : (
          <p className="coord-empty">Select a disruption to see details.</p>
        )}
      </div>
    </div>
    </div>
  );
}
