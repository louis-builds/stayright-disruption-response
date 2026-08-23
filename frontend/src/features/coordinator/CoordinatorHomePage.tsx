import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { coordinatorGroupForTab, CoordinatorTopNav, type CoordinatorTab } from "../../shared/components/CoordinatorTopNav";
import { useAuth } from "../auth";
import * as api from "./api";
import { BadCasesPanel } from "./BadCasesPanel";
import { DisruptionsPanel } from "./DisruptionsPanel";
import { escalationReasonLabel } from "./escalationLabels";
import { KnowledgeBasePanel } from "./KnowledgeBasePanel";
import { OpsPage } from "./OpsPage";
import { Pagination, usePagination } from "../../shared/components/Pagination";
import { SystemAdminPanel } from "./SystemAdminPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { CaseNote, CaseQueueItem, CoordinatorOption, OverviewDto } from "./types";
import "./CoordinatorHomePage.css";

type Tab = CoordinatorTab;

const ESCALATION_FILTERS = [
  { value: "", label: "All reasons" },
  { value: "all_rejected", label: "Guest rejected all options" },
  { value: "must_manual", label: "Must be manual" },
  { value: "ai_stuck", label: "AI stuck" },
  { value: "low_confidence", label: "AI low confidence" },
  { value: "high_risk", label: "High risk" },
];

function formatWait(iso: string) {
  // .NET TimeSpan.ToString() switches format once days > 0: "hh:mm:ss[.fff]" becomes
  // "d.hh:mm:ss[.fff]" — the day count before the first ":" must be pulled out first,
  // otherwise splitting on ":" alone leaves "d.hh" (e.g. "1.01") as the "hours" field.
  const dotIdx = iso.indexOf(".");
  const colonIdx = iso.indexOf(":");
  const hasDayPrefix = dotIdx !== -1 && dotIdx < colonIdx;
  const days = hasDayPrefix ? parseInt(iso.slice(0, dotIdx), 10) : 0;
  const rest = hasDayPrefix ? iso.slice(dotIdx + 1) : iso;
  const [h, m] = rest.split(":");
  const hours = days * 24 + parseInt(h, 10);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${m}m`;
}

function OverviewPanel({ data, syncedAt }: { data: OverviewDto | null; syncedAt: Date | null }) {
  if (!data) return <p className="coord-empty">Loading…</p>;
  return (
    <>
    {syncedAt && (
      <p className="coord-sync-indicator">
        <span className="coord-sync-dot" aria-hidden="true" />
        Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
      </p>
    )}
    <div className="coord-overview-grid">
      <div className="coord-stat-card">
        <span className="coord-stat-label">Active disruptions</span>
        <span className="coord-stat-value">
          {data.activeWeatherCount + data.activeFlightCount + data.activeRoadCount}
        </span>
        <span className="coord-stat-sub">
          {data.activeWeatherCount} weather · {data.activeFlightCount} flight · {data.activeRoadCount} road
        </span>
      </div>
      <div className="coord-stat-card">
        <span className="coord-stat-label">New affected bookings today</span>
        <span className="coord-stat-value">{data.newAffectedBookingsToday}</span>
      </div>
      <div className="coord-stat-card">
        <span className="coord-stat-label">Pending / In progress / Closed today</span>
        <span className="coord-stat-value">
          {data.pendingCount} / {data.inProgressCount} / {data.closedTodayCount}
        </span>
      </div>
      <div className="coord-stat-card coord-stat-card-warn">
        <span className="coord-stat-label">Overdue in-progress cases</span>
        <span className="coord-stat-value">{data.overdueInProgressCount}</span>
      </div>
      {data.biggestImpactDisruptionTitle && (
        <div className="coord-stat-card coord-stat-card-wide">
          <span className="coord-stat-label">Biggest impact event</span>
          <span className="coord-stat-value coord-stat-value-sm">{data.biggestImpactDisruptionTitle}</span>
          <span className="coord-stat-sub">{data.biggestImpactAffectedCount} affected cases</span>
        </div>
      )}
    </div>
    </>
  );
}

interface CaseTableProps {
  items: CaseQueueItem[];
  loading: boolean;
  showAssignee?: boolean;
  actionable?: boolean;
  onOpen: (caseId: string) => void;
  onOptions?: (caseId: string) => void;
  onEscalate?: (caseId: string) => void;
  onTransfer?: (item: CaseQueueItem) => void;
  onClose?: (item: CaseQueueItem) => void;
  onNotes?: (item: CaseQueueItem) => void;
}

function CaseTable({ items, loading, showAssignee, actionable, onOpen, onOptions, onEscalate, onTransfer, onClose, onNotes }: CaseTableProps) {
  const { paged, page, setPage, totalPages } = usePagination(items);

  if (loading) return <p className="coord-empty">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="hotel-caught-up">
        <span className="hotel-caught-up-icon" aria-hidden="true">
          ✨
        </span>
        <p className="hotel-caught-up-title">Nothing here right now</p>
        <p className="hotel-caught-up-body">New cases will appear here automatically as they're created or assigned — no need to refresh.</p>
      </div>
    );
  }

  return (
    <>
    <div className="coord-table">
      {paged.map((it) => (
        <div key={it.caseId} className={`coord-row ${it.overdue ? "coord-row-overdue" : ""}`}>
          <div className="coord-row-main">
            <div className="coord-row-title">
              <span className="coord-row-conf">{it.confirmationNo}</span>
              <span className={`tag tag-status-${it.priority === "high" ? "warn" : "normal"}`}>{it.priority}</span>
              {it.overdue && <span className="tag tag-status-overdue">overdue</span>}
              {it.isHighValueGuest && <span className="tag tag-status-vip">returning guest</span>}
            </div>
            <p className="coord-row-sub">
              {it.guestNickname} · {it.disruptionTitle}
              {it.escalationReason && ` · ${escalationReasonLabel(it.escalationReason)}`}
            </p>
            <p className="coord-row-meta">
              {it.status === "closed" ? "resolved after" : "waiting"} {formatWait(it.waitTime)}
              {showAssignee && it.assigneeNickname && ` · assigned to ${it.assigneeNickname}`}
              {showAssignee && !it.assigneeNickname && " · unassigned"}
            </p>
          </div>
          <div className="coord-row-actions">
            <button type="button" className="coord-btn-link" onClick={() => onOpen(it.caseId)}>
              Open conversation
            </button>
            {it.escalationReason && (
              <button type="button" className="coord-btn-link" onClick={() => onEscalate?.(it.caseId)}>
                Escalation desk
              </button>
            )}
            {actionable && (
              <>
                <button type="button" className="coord-btn-link" onClick={() => onOptions?.(it.caseId)}>
                  Options
                </button>
                <button type="button" className="coord-btn-link" onClick={() => onNotes?.(it)}>
                  Notes
                </button>
                <button type="button" className="coord-btn-link" onClick={() => onTransfer?.(it)}>
                  Transfer
                </button>
                <button type="button" className="coord-btn-link coord-btn-danger" onClick={() => onClose?.(it)}>
                  Close case
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
    <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </>
  );
}

// 后端把结案原因存成中文业务枚举值(OpsService 按这些原文字符串统计改订成功率，不能改存值)，
// 下拉框只做展示层翻译，跟 MyBookingsPage 客人那边给自己看的翻译是同一套用词，保持一致。
const CLOSE_REASONS = [
  { value: "改订成功结案", label: "Rebooking succeeded" },
  { value: "取消退款完成结案", label: "Cancel & refund" },
  { value: "客人自行关闭或超时结案", label: "Closed by guest / timed out" },
  { value: "人工决议结案", label: "Resolved manually" },
  { value: "误伤关闭", label: "Closed in error" },
  { value: "重复案合并关闭", label: "Merged with duplicate case" },
];

function TransferModal({ item, coordinators, onCancel, onConfirm }: {
  item: CaseQueueItem; coordinators: CoordinatorOption[]; onCancel: () => void; onConfirm: (toId: string) => void;
}) {
  const [toId, setToId] = useState(coordinators[0]?.id ?? "");
  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Transfer {item.confirmationNo}</h3>
        <label className="coord-field">
          <span>Transfer to</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {coordinators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
              </option>
            ))}
          </select>
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" disabled={!toId} onClick={() => onConfirm(toId)}>
            Confirm transfer
          </button>
        </div>
      </div>
    </div>
  );
}

function CloseModal({ item, onCancel, onConfirm }: {
  item: CaseQueueItem; onCancel: () => void; onConfirm: (reason: string, summary: string) => void;
}) {
  const [reason, setReason] = useState(CLOSE_REASONS[0].value);
  const [summary, setSummary] = useState("");
  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Close {item.confirmationNo}</h3>
        <label className="coord-field">
          <span>Close reason</span>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {CLOSE_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="coord-field">
          <span>Result summary</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="What happened and how it was resolved…" />
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" disabled={!summary.trim()} onClick={() => onConfirm(reason, summary.trim())}>
            Confirm close
          </button>
        </div>
      </div>
    </div>
  );
}

function NotesModal({ item, onCancel }: { item: CaseQueueItem; onCancel: () => void }) {
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await api.fetchNotes(item.caseId);
    if (res.code === 0) setNotes(res.data);
    setLoading(false);
  }, [item.caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit() {
    if (!body.trim()) return;
    await api.addNote(item.caseId, body.trim());
    setBody("");
    await refresh();
  }

  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Internal notes — {item.confirmationNo}</h3>
        <p className="coord-modal-hint">Only visible to coordinators, not the guest.</p>
        {loading ? (
          <p className="coord-empty">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="coord-empty">No notes yet.</p>
        ) : (
          <ul className="coord-notes-list">
            {notes.map((n) => (
              <li key={n.id}>
                <span className="coord-note-author">{n.authorNickname}</span>
                <span className="coord-note-body">{n.body}</span>
              </li>
            ))}
          </ul>
        )}
        <label className="coord-field">
          <span>Add a note</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Close
          </button>
          <button type="button" className="coord-btn-primary" disabled={!body.trim()} onClick={() => void submit()}>
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}

export function CoordinatorHomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const initialTab = (location.state as { tab?: Tab } | null)?.tab;
  const [tab, setTab] = useState<Tab>(initialTab ?? "overview");
  const [overview, setOverview] = useState<OverviewDto | null>(null);
  const [overviewSyncedAt, setOverviewSyncedAt] = useState<Date | null>(null);
  const [items, setItems] = useState<CaseQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [escalationFilter, setEscalationFilter] = useState("");
  const [queueFilter, setQueueFilter] = useState("");
  const [queueSyncedAt, setQueueSyncedAt] = useState<Date | null>(null);
  const [tasksSyncedAt, setTasksSyncedAt] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [coordinators, setCoordinators] = useState<CoordinatorOption[]>([]);
  const [transferTarget, setTransferTarget] = useState<CaseQueueItem | null>(null);
  const [closeTarget, setCloseTarget] = useState<CaseQueueItem | null>(null);
  const [notesTarget, setNotesTarget] = useState<CaseQueueItem | null>(null);

  // loadTab/这几个 30s 轮询都会异步拉数据回来写 items/overview，互相之间(以及跟切 tab、切筛选)
  // 完全没有先后顺序保证——网络一抖动，更早发出但更晚返回的请求就会覆盖掉更新、更快返回的那个
  // (亲测复现：快速切换升级原因筛选，旧筛选的慢请求最后落地会把新筛选的结果悄悄换回旧数据，
  // 下拉框显示的筛选条件跟表格实际内容对不上)。每次发起这几个请求前都领一个新序号，落地时只有
  // 序号还是当前最新的那个才允许真的写 state，比更早发出的请求都晚返回。
  const latestRequestIdRef = useRef(0);

  const loadTab = useCallback(async () => {
    setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    if (tab === "overview") {
      const res = await api.fetchOverview();
      if (requestId === latestRequestIdRef.current && res.code === 0) {
        setOverview(res.data);
        setOverviewSyncedAt(new Date());
      }
    } else if (tab === "queue") {
      const res = await api.fetchQueue(escalationFilter || undefined);
      if (requestId === latestRequestIdRef.current && res.code === 0) {
        setItems(res.data);
        setQueueSyncedAt(new Date());
      }
    } else if (tab === "todo") {
      const res = await api.fetchMine("pending");
      if (requestId === latestRequestIdRef.current && res.code === 0) {
        setItems(res.data);
        setTasksSyncedAt(new Date());
      }
    } else if (tab === "in_progress") {
      const res = await api.fetchMine("in_progress");
      if (requestId === latestRequestIdRef.current && res.code === 0) {
        setItems(res.data);
        setTasksSyncedAt(new Date());
      }
    } else if (tab === "closed") {
      const res = await api.fetchClosed(30);
      if (requestId === latestRequestIdRef.current && res.code === 0) {
        setItems(res.data);
        setTasksSyncedAt(new Date());
      }
    } else if (tab === "search") {
      const res = await api.search(searchQuery.trim());
      if (requestId === latestRequestIdRef.current && res.code === 0) setItems(res.data);
    }
    if (requestId === latestRequestIdRef.current) setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, escalationFilter]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  // Dashboard 概览之前只在切进这个 tab 时拉一次，别的协调员/酒店那边的操作不会自己冒出来——
  // 静默轮询(不摸 loading，不闪屏)，跟客人端通知轮询同一套节奏(30s)。
  useEffect(() => {
    if (tab !== "overview") return;
    const timer = window.setInterval(() => {
      const requestId = ++latestRequestIdRef.current;
      void api.fetchOverview().then((res) => {
        if (requestId === latestRequestIdRef.current && res.code === 0) {
          setOverview(res.data);
          setOverviewSyncedAt(new Date());
        }
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  // 升级队列同理：别的协调员处理/新升级案件不会自己冒出来，静默轮询。
  useEffect(() => {
    if (tab !== "queue") return;
    const timer = window.setInterval(() => {
      const requestId = ++latestRequestIdRef.current;
      void api.fetchQueue(escalationFilter || undefined).then((res) => {
        if (requestId === latestRequestIdRef.current && res.code === 0) {
          setItems(res.data);
          setQueueSyncedAt(new Date());
        }
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [tab, escalationFilter]);

  // My to-dos / My in-progress / Closed 同理：别的案件被指派给我、或我这边案件被别的动作改了状态，
  // 不会自己冒出来，静默轮询。
  useEffect(() => {
    if (tab !== "todo" && tab !== "in_progress" && tab !== "closed") return;
    const fetcher =
      tab === "todo" ? () => api.fetchMine("pending") : tab === "in_progress" ? () => api.fetchMine("in_progress") : () => api.fetchClosed(30);
    const timer = window.setInterval(() => {
      const requestId = ++latestRequestIdRef.current;
      void fetcher().then((res) => {
        if (requestId === latestRequestIdRef.current && res.code === 0) {
          setItems(res.data);
          setTasksSyncedAt(new Date());
        }
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  useEffect(() => {
    void api.fetchCoordinators().then((res) => {
      if (res.code === 0) setCoordinators(res.data);
    });
  }, []);

  async function runSearch() {
    setLoading(true);
    // 这个 Search 按钮本身的 disabled={loading} 只挡得住"连点同一个按钮两下"——切到别的 Tasks
    // 子tab 的按钮完全不受 loading 影响,搜索请求还没返回时切走,这个函数原来会在切走之后无条件
    // setItems 把已经换了 tab 的表格内容覆盖回这次搜索的旧结果。跟 loadTab()/三个轮询共用同一个
    // latestRequestIdRef,晚到的过期响应就不会再生效。
    const requestId = ++latestRequestIdRef.current;
    const res = await api.search(searchQuery.trim());
    if (requestId === latestRequestIdRef.current && res.code === 0) setItems(res.data);
    if (requestId === latestRequestIdRef.current) setLoading(false);
  }

  function matchesTaskFilter(it: CaseQueueItem) {
    const needle = taskFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      it.confirmationNo.toLowerCase().includes(needle) ||
      it.guestNickname.toLowerCase().includes(needle) ||
      it.disruptionTitle.toLowerCase().includes(needle)
    );
  }

  function matchesQueueFilter(it: CaseQueueItem) {
    const needle = queueFilter.trim().toLowerCase();
    if (!needle) return true;
    return (
      it.confirmationNo.toLowerCase().includes(needle) ||
      it.guestNickname.toLowerCase().includes(needle) ||
      it.disruptionTitle.toLowerCase().includes(needle) ||
      (it.assigneeNickname?.toLowerCase().includes(needle) ?? false)
    );
  }

  const queueStats = useMemo(() => {
    const byReason = new Map<string, number>();
    let overdueCount = 0;
    let highValueCount = 0;
    for (const it of items) {
      if (it.escalationReason) {
        const label = escalationReasonLabel(it.escalationReason);
        byReason.set(label, (byReason.get(label) ?? 0) + 1);
      }
      if (it.overdue) overdueCount++;
      if (it.isHighValueGuest) highValueCount++;
    }
    return {
      total: items.length,
      overdueCount,
      highValueCount,
      byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [items]);

  const taskStats = useMemo(() => {
    const filtered = items.filter(matchesTaskFilter);
    const byDisruption = new Map<string, number>();
    for (const it of filtered) {
      byDisruption.set(it.disruptionTitle, (byDisruption.get(it.disruptionTitle) ?? 0) + 1);
    }
    return {
      total: filtered.length,
      overdueCount: filtered.filter((it) => it.overdue).length,
      highValueCount: filtered.filter((it) => it.isHighValueGuest).length,
      byDisruption: [...byDisruption.entries()].sort((a, b) => b[1] - a[1]),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, taskFilter]);

  // 全局搜索横跨所有状态(pending/in_progress/closed混在一起)，其它 tab 里状态是单一的所以不用统计，
  // 这里单独按状态分组才有意义。
  const searchStats = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const it of items) byStatus.set(it.status, (byStatus.get(it.status) ?? 0) + 1);
    return {
      total: items.length,
      overdueCount: items.filter((it) => it.overdue).length,
      byStatus: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [items]);

  async function confirmTransfer(toId: string) {
    if (!transferTarget) return;
    await api.transferCase(transferTarget.caseId, toId);
    setTransferTarget(null);
    await loadTab();
  }

  async function confirmClose(reason: string, summary: string) {
    if (!closeTarget) return;
    await api.closeCase(closeTarget.caseId, reason, summary);
    setCloseTarget(null);
    await loadTab();
  }

  if (!user) return null;

  const showActions = tab === "todo" || tab === "in_progress";
  const showAssignee = tab === "queue" || tab === "closed" || tab === "search";

  const activeGroup = coordinatorGroupForTab(tab);

  return (
    <AppShell centerContent={<CoordinatorTopNav activeTab={tab} onSelectTab={setTab} />}>
      <div className="coord-home">
        {activeGroup && activeGroup.tabs.length > 1 && (
          <div className="coord-tabs">
            {activeGroup.tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`coord-tab ${tab === t.key ? "coord-tab-active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        <div className="coord-panel">
          {tab === "overview" && (
            <div className="coord-overview-wrap">
              <OverviewPanel data={overview} syncedAt={overviewSyncedAt} />
              <OpsPage />
            </div>
          )}

          {tab === "disruptions" && <DisruptionsPanel coordinators={coordinators} />}

          {tab === "admin" && <SystemAdminPanel />}

          {tab === "kb" && <KnowledgeBasePanel />}

          {tab === "bad_cases" && <BadCasesPanel />}

          {tab === "settings" && <SettingsPanel />}

          {tab === "queue" && (
            <>
              <div className="coord-queue-stats">
                <div className="coord-stat-card">
                  <span className="coord-stat-label">In queue</span>
                  <span className="coord-stat-value">{queueStats.total}</span>
                </div>
                <div className="coord-stat-card coord-stat-card-warn">
                  <span className="coord-stat-label">Overdue</span>
                  <span className="coord-stat-value">{queueStats.overdueCount}</span>
                </div>
                <div className="coord-stat-card">
                  <span className="coord-stat-label">Returning guests</span>
                  <span className="coord-stat-value">{queueStats.highValueCount}</span>
                </div>
                <div className="coord-stat-card coord-stat-card-wide coord-queue-reason-card">
                  <span className="coord-stat-label">By reason</span>
                  {queueStats.byReason.length === 0 ? (
                    <span className="coord-stat-sub">No reasons recorded.</span>
                  ) : (
                    <div className="coord-queue-reason-bars">
                      {queueStats.byReason.map(([label, count]) => (
                        <div key={label} className="coord-queue-reason-row">
                          <span className="coord-queue-reason-label">{label}</span>
                          <div className="coord-queue-reason-track">
                            <div
                              className="coord-queue-reason-fill"
                              style={{ width: `${(count / queueStats.total) * 100}%` }}
                            />
                          </div>
                          <span className="coord-queue-reason-count">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="coord-toolbar">
                <select value={escalationFilter} onChange={(e) => setEscalationFilter(e.target.value)}>
                  {ESCALATION_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <input
                  className="coord-search-input"
                  placeholder="Search by confirmation no / guest / disruption / owner"
                  value={queueFilter}
                  onChange={(e) => setQueueFilter(e.target.value)}
                />
                {queueSyncedAt && (
                  <p className="coord-sync-indicator coord-queue-sync">
                    <span className="coord-sync-dot" aria-hidden="true" />
                    Synced {queueSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
                  </p>
                )}
              </div>
              <CaseTable
                items={items.filter(matchesQueueFilter)}
                loading={loading}
                showAssignee={showAssignee}
                onOpen={(id) => navigate(`/cases/${id}`)}
                onEscalate={(id) => navigate(`/coordinator/cases/${id}/escalation`)}
              />
            </>
          )}

          {tab === "search" && (
            <>
              <div className="coord-queue-stats">
                <div className="coord-stat-card">
                  <span className="coord-stat-label">Results</span>
                  <span className="coord-stat-value">{searchStats.total}</span>
                </div>
                <div className="coord-stat-card coord-stat-card-warn">
                  <span className="coord-stat-label">Overdue</span>
                  <span className="coord-stat-value">{searchStats.overdueCount}</span>
                </div>
                <div className="coord-stat-card coord-stat-card-wide coord-queue-reason-card">
                  <span className="coord-stat-label">By status</span>
                  {searchStats.byStatus.length === 0 ? (
                    <span className="coord-stat-sub">No results yet.</span>
                  ) : (
                    <div className="coord-queue-reason-bars">
                      {searchStats.byStatus.map(([status, count]) => (
                        <div key={status} className="coord-queue-reason-row">
                          <span className="coord-queue-reason-label">{status.replace("_", " ")}</span>
                          <div className="coord-queue-reason-track">
                            <div
                              className="coord-queue-reason-fill"
                              style={{ width: `${(count / searchStats.total) * 100}%` }}
                            />
                          </div>
                          <span className="coord-queue-reason-count">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="coord-toolbar">
                <input
                  className="coord-search-input"
                  placeholder="Confirmation no / name / email / phone"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                />
                <button type="button" className="coord-btn-primary" disabled={loading} onClick={() => void runSearch()}>
                  {loading ? <span className="coord-search-spinner" aria-hidden="true" /> : "Search"}
                </button>
              </div>
              <CaseTable
                items={items}
                loading={loading}
                showAssignee={showAssignee}
                onOpen={(id) => navigate(`/cases/${id}`)}
                onEscalate={(id) => navigate(`/coordinator/cases/${id}/escalation`)}
              />
            </>
          )}

          {(tab === "todo" || tab === "in_progress" || tab === "closed") && (
            <div className="coord-task-tab-layout">
              <div className="coord-task-tab-main">
              <div className="coord-queue-stats">
                <div className="coord-stat-card">
                  <span className="coord-stat-label">{tab === "closed" ? "Closed (30d)" : "Showing"}</span>
                  <span className="coord-stat-value">{taskStats.total}</span>
                </div>
                <div className="coord-stat-card coord-stat-card-warn">
                  <span className="coord-stat-label">Overdue</span>
                  <span className="coord-stat-value">{taskStats.overdueCount}</span>
                </div>
                <div className="coord-stat-card">
                  <span className="coord-stat-label">Returning guests</span>
                  <span className="coord-stat-value">{taskStats.highValueCount}</span>
                </div>
                <div className="coord-stat-card coord-stat-card-wide coord-queue-reason-card">
                  <span className="coord-stat-label">By disruption</span>
                  {taskStats.byDisruption.length === 0 ? (
                    <span className="coord-stat-sub">Nothing to break down yet.</span>
                  ) : (
                    <div className="coord-queue-reason-bars">
                      {taskStats.byDisruption.map(([label, count]) => (
                        <div key={label} className="coord-queue-reason-row">
                          <span className="coord-queue-reason-label">{label}</span>
                          <div className="coord-queue-reason-track">
                            <div className="coord-queue-reason-fill" style={{ width: `${(count / taskStats.total) * 100}%` }} />
                          </div>
                          <span className="coord-queue-reason-count">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="coord-toolbar">
                <input
                  className="coord-search-input"
                  placeholder="Filter by confirmation no / guest / disruption"
                  value={taskFilter}
                  onChange={(e) => setTaskFilter(e.target.value)}
                />
                {tasksSyncedAt && (
                  <p className="coord-sync-indicator coord-queue-sync">
                    <span className="coord-sync-dot" aria-hidden="true" />
                    Synced {tasksSyncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
                  </p>
                )}
              </div>
              <CaseTable
                items={items.filter(matchesTaskFilter)}
                loading={loading}
                showAssignee={showAssignee}
                actionable={showActions}
                onOpen={(id) => navigate(`/cases/${id}`)}
                onOptions={(id) => navigate(`/coordinator/cases/${id}/options`)}
                onEscalate={(id) => navigate(`/coordinator/cases/${id}/escalation`)}
                onTransfer={setTransferTarget}
                onClose={setCloseTarget}
                onNotes={setNotesTarget}
              />
              </div>
              <div className="coord-task-tab-decor" aria-hidden="true">
                <span className="coord-task-tab-decor-icon">
                  {tab === "closed" ? "🗂️" : tab === "in_progress" ? "🧭" : "📋"}
                </span>
                <p className="coord-task-tab-decor-caption">
                  {tab === "closed" ? "Resolved & archived" : tab === "in_progress" ? "In motion" : "Ready when you are"}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {transferTarget && (
        <TransferModal
          item={transferTarget}
          coordinators={coordinators}
          onCancel={() => setTransferTarget(null)}
          onConfirm={(toId) => void confirmTransfer(toId)}
        />
      )}
      {closeTarget && (
        <CloseModal item={closeTarget} onCancel={() => setCloseTarget(null)} onConfirm={(r, s) => void confirmClose(r, s)} />
      )}
      {notesTarget && <NotesModal item={notesTarget} onCancel={() => setNotesTarget(null)} />}
    </AppShell>
  );
}
