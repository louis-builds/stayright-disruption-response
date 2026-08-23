import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { HotelTopNav, type HotelTab } from "../../shared/components/HotelTopNav";
import { Pagination, usePagination } from "../../shared/components/Pagination";
import { useAuth } from "../auth";
import * as api from "./api";
import { HotelProfilePanel } from "./HotelProfilePanel";
import type { HotelPerk, InquiryItem, SelectedOptionItem } from "./types";
import "../coordinator/CoordinatorHomePage.css";
import "./HotelHomePage.css";

type Tab = HotelTab;

const TASK_TABS: { key: Tab; label: string }[] = [
  { key: "todo", label: "My to-dos" },
  { key: "done", label: "Done" },
];

function matchesHotelFilter(needle: string, ...fields: (string | undefined)[]) {
  if (!needle.trim()) return true;
  const q = needle.trim().toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function RejectModal({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>{title}</h3>
        <label className="coord-field">
          <span>Reason (required)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Confirm reject
          </button>
        </div>
      </div>
    </div>
  );
}

function PerkCheckboxes({ perks, selected, onToggle }: { perks: HotelPerk[]; selected: string[]; onToggle: (name: string) => void }) {
  if (perks.length === 0) return <p className="coord-empty">No perks yet — add some in Hotel profile.</p>;
  return (
    <div className="hotel-perk-checkboxes">
      {perks.map((p) => (
        <label key={p.id} className="hotel-perk-checkbox">
          <input type="checkbox" checked={selected.includes(p.name)} onChange={() => onToggle(p.name)} />
          {p.name}
        </label>
      ))}
    </div>
  );
}

function PerksModal({ option, perks, onCancel, onConfirm }: {
  option: SelectedOptionItem; perks: HotelPerk[]; onCancel: () => void; onConfirm: (perkNames: string[]) => void;
}) {
  const [selected, setSelected] = useState(option.perkNames);

  function toggle(name: string) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Add perks — {option.confirmationNo}</h3>
        <PerkCheckboxes perks={perks} selected={selected} onToggle={toggle} />
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" onClick={() => onConfirm(selected)}>
            Save perks
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomOptionModal({ confirmationNo, perks, onCancel, onConfirm }: {
  confirmationNo: string; perks: HotelPerk[]; onCancel: () => void; onConfirm: (title: string, perkNames: string[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(name: string) {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  }

  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Offer custom option — {confirmationNo}</h3>
        <label className="coord-field">
          <span>Title (e.g. Free room upgrade)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <PerkCheckboxes perks={perks} selected={selected} onToggle={toggle} />
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" disabled={!title.trim()} onClick={() => onConfirm(title.trim(), selected)}>
            Offer option
          </button>
        </div>
      </div>
    </div>
  );
}

export function HotelHomePage() {
  const { user } = useAuth();
  const location = useLocation();
  const initialTab = (location.state as { tab?: Tab } | null)?.tab;
  const [tab, setTab] = useState<Tab>(initialTab ?? "todo");

  const [pendingInquiries, setPendingInquiries] = useState<InquiryItem[]>([]);
  const [pendingOptions, setPendingOptions] = useState<SelectedOptionItem[]>([]);
  const [doneInquiries, setDoneInquiries] = useState<InquiryItem[]>([]);
  const [doneOptions, setDoneOptions] = useState<SelectedOptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskFilter, setTaskFilter] = useState("");
  const [rejectTarget, setRejectTarget] = useState<{ kind: "inquiry" | "option"; id: string; label: string } | null>(null);
  const [perks, setPerks] = useState<HotelPerk[]>([]);
  const [profileSnapshot, setProfileSnapshot] = useState<{ name: string; address: string; roomTypeCount: number } | null>(null);
  const [perksTarget, setPerksTarget] = useState<SelectedOptionItem | null>(null);
  const [customOptionTarget, setCustomOptionTarget] = useState<{ caseId: string; confirmationNo: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  // refresh() 虽然被挂载/30秒轮询/每个操作动作(确认/拒绝/加礼遇/开自定义方案)统一复用,
  // 但这只是共用同一段代码,不代表并发调用之间有先后顺序保证——亲测复现过:酒店员工点了
  // "Confirm deferral",这次调用很快把这一行从待办移除(正确),但紧接着一个更早发出、这时才
  // 姗姗来迟落地的轮询调用(里面还是确认前的旧数据)会把这一行悄悄拉回待办列表。给每次调用领一个
  // 新序号，落地时只有序号还是当前最新的那个才允许真的写 state。
  const latestRequestIdRef = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    const [pendingInqRes, pendingOptRes, doneInqRes, doneOptRes, profileRes] = await Promise.all([
      api.fetchInquiries("pending"),
      api.fetchSelectedOptions(),
      api.fetchInquiries(),
      api.fetchSelectedOptionsHistory(),
      api.fetchProfile(),
    ]);
    if (requestId === latestRequestIdRef.current) {
      if (pendingInqRes.code === 0) setPendingInquiries(pendingInqRes.data);
      if (pendingOptRes.code === 0) setPendingOptions(pendingOptRes.data);
      if (doneInqRes.code === 0) setDoneInquiries(doneInqRes.data.filter((i) => i.status !== "pending"));
      if (doneOptRes.code === 0) setDoneOptions(doneOptRes.data);
      if (profileRes.code === 0) {
        setPerks(profileRes.data.perks);
        setProfileSnapshot({ name: profileRes.data.name, address: profileRes.data.address, roomTypeCount: profileRes.data.roomTypes.length });
      }
      if (!opts?.silent) setLoading(false);
      setSyncedAt(new Date());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // My to-dos 是酒店员工随时盯着的队列，新的中断/改订请求随时可能进来——静默轮询，
  // 不摸 loading（避免正在看的行被整页“Loading…”打断），只在这个 tab 下跑。
  useEffect(() => {
    if (tab !== "todo") return;
    const timer = window.setInterval(() => void refresh({ silent: true }), 30_000);
    return () => window.clearInterval(timer);
  }, [tab, refresh]);

  async function confirmInquiry(id: string) {
    setBusyId(id);
    await api.confirmInquiry(id);
    setBusyId(null);
    await refresh({ silent: true });
  }

  async function confirmOption(id: string) {
    setBusyId(id);
    await api.confirmOption(id);
    setBusyId(null);
    await refresh({ silent: true });
  }

  async function doReject(reason: string) {
    if (!rejectTarget) return;
    if (rejectTarget.kind === "inquiry") await api.rejectInquiry(rejectTarget.id, reason);
    else await api.rejectOption(rejectTarget.id, reason);
    setRejectTarget(null);
    await refresh({ silent: true });
  }

  async function saveOptionPerks(perkNames: string[]) {
    if (!perksTarget) return;
    await api.setOptionPerks(perksTarget.optionId, perkNames);
    setPerksTarget(null);
    await refresh({ silent: true });
  }

  async function offerCustomOption(title: string, perkNames: string[]) {
    if (!customOptionTarget) return;
    await api.createCustomOption(customOptionTarget.caseId, title, perkNames);
    setCustomOptionTarget(null);
    await refresh({ silent: true });
  }

  const isTaskTab = tab === "todo" || tab === "done";

  const filteredPendingInquiries = pendingInquiries
    .filter((i) => matchesHotelFilter(taskFilter, i.confirmationNo, i.guestNickname, i.disruptionTitle))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue));
  const filteredPendingOptions = pendingOptions
    .filter((o) => matchesHotelFilter(taskFilter, o.confirmationNo, o.guestNickname, o.optionType))
    .sort((a, b) => Number(b.isHighValueGuest) - Number(a.isHighValueGuest) || a.selectedSince.localeCompare(b.selectedSince));
  const filteredDoneInquiries = doneInquiries
    .filter((i) => matchesHotelFilter(taskFilter, i.confirmationNo, i.guestNickname, i.disruptionTitle, i.status))
    .sort((a, b) => (b.respondedAt ?? "").localeCompare(a.respondedAt ?? ""));
  const filteredDoneOptions = doneOptions
    .filter((o) => matchesHotelFilter(taskFilter, o.confirmationNo, o.guestNickname, o.optionType, o.availability))
    .sort((a, b) => b.selectedSince.localeCompare(a.selectedSince));

  const pendingInquiriesPage = usePagination(filteredPendingInquiries);
  const pendingOptionsPage = usePagination(filteredPendingOptions);
  const doneInquiriesPage = usePagination(filteredDoneInquiries);
  const doneOptionsPage = usePagination(filteredDoneOptions);

  const todoStats = useMemo(
    () => ({
      h1Total: pendingInquiries.length,
      overdueCount: pendingInquiries.filter((i) => i.overdue).length,
      h2Total: pendingOptions.length,
      highValueCount: pendingInquiries.filter((i) => i.isHighValueGuest).length + pendingOptions.filter((o) => o.isHighValueGuest).length,
    }),
    [pendingInquiries, pendingOptions],
  );

  const doneStats = useMemo(() => {
    const acceptedCount = doneInquiries.filter((i) => i.status === "accepted").length;
    const rejectedCount = doneInquiries.filter((i) => i.status === "rejected").length;
    const availableCount = doneOptions.filter((o) => o.availability === "available").length;
    const unavailableCount = doneOptions.filter((o) => o.availability === "unavailable").length;
    const byOutcome: [string, number][] = [
      ["H1 accepted", acceptedCount],
      ["H1 rejected", rejectedCount],
      ["H2 confirmed", availableCount],
      ["H2 declined", unavailableCount],
    ].filter(([, count]) => count > 0);
    const total = acceptedCount + rejectedCount + availableCount + unavailableCount;
    return { acceptedCount, rejectedCount, availableCount, unavailableCount, byOutcome, total };
  }, [doneInquiries, doneOptions]);

  if (!user) return null;

  return (
    <AppShell centerContent={<HotelTopNav activeTab={tab} onSelectTab={setTab} />}>
      <div className="coord-home">
        {isTaskTab && (
          <div className="coord-tabs">
            {TASK_TABS.map((t) => (
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
          {isTaskTab && (
            <div className="coord-toolbar">
              <input
                className="coord-search-input"
                placeholder={
                  tab === "todo"
                    ? "Filter by confirmation no / guest / disruption / option type"
                    : "Filter by confirmation no / guest / disruption / status / option type"
                }
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              />
            </div>
          )}
          {tab === "todo" && syncedAt && (pendingInquiries.length > 0 || pendingOptions.length > 0) && (
            <p className="coord-sync-indicator">
              <span className="coord-sync-dot" aria-hidden="true" />
              Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
            </p>
          )}
          {tab === "todo" && (
            <div className="coord-queue-stats">
              <div className={`coord-stat-card ${todoStats.overdueCount > 0 ? "coord-stat-card-warn" : ""}`}>
                <span className="coord-stat-label">Disruption requests (H1)</span>
                <span className="coord-stat-value">{todoStats.h1Total}</span>
                <span className="coord-stat-sub">
                  {todoStats.overdueCount > 0 && <span className="hotel-overdue-dot" aria-hidden="true" />}
                  {todoStats.overdueCount} overdue
                </span>
              </div>
              <div className="coord-stat-card">
                <span className="coord-stat-label">Guest selections (H2)</span>
                <span className="coord-stat-value">{todoStats.h2Total}</span>
                <span className="coord-stat-sub">awaiting hotel confirmation</span>
              </div>
              <div className="coord-stat-card">
                <span className="coord-stat-label">Returning guests</span>
                <span className="coord-stat-value">{todoStats.highValueCount}</span>
                <span className="coord-stat-sub">across both queues</span>
              </div>
            </div>
          )}
          {loading ? (
            <p className="coord-empty">Loading…</p>
          ) : tab === "todo" && pendingInquiries.length === 0 && pendingOptions.length === 0 ? (
            <div className="hotel-caught-up">
              <span className="hotel-caught-up-icon" aria-hidden="true">
                ✅
              </span>
              <p className="hotel-caught-up-title">You're all caught up</p>
              <p className="hotel-caught-up-body">
                No pending disruption deferral requests (H1) or guest rebooking selections (H2) right now. New requests
                will show up here as soon as a disruption affects one of your bookings or a guest confirms a plan.
              </p>
              {profileSnapshot && (
                <div className="hotel-caught-up-snapshot">
                  <div>
                    <span className="hotel-caught-up-snapshot-value">{profileSnapshot.roomTypeCount}</span>
                    <span className="hotel-caught-up-snapshot-label">room types listed</span>
                  </div>
                  <div>
                    <span className="hotel-caught-up-snapshot-value">{perks.length}</span>
                    <span className="hotel-caught-up-snapshot-label">perks available to offer</span>
                  </div>
                  <div>
                    <span className="hotel-caught-up-snapshot-value hotel-caught-up-snapshot-value-sm">{profileSnapshot.address}</span>
                    <span className="hotel-caught-up-snapshot-label">{profileSnapshot.name}</span>
                  </div>
                </div>
              )}
            </div>
          ) : tab === "todo" ? (
            <>
              <h3>H1 — Disruption deferral requests</h3>
              {filteredPendingInquiries.length === 0 ? (
                <p className="coord-empty">No pending disruption requests.</p>
              ) : (
                <div className="coord-table" style={{ marginBottom: "1.2rem" }}>
                  {pendingInquiriesPage.paged.map((i) => (
                    <div key={i.id} className={`coord-row ${i.overdue ? "coord-row-overdue" : ""}`}>
                      <div className="coord-row-main">
                        <span className="coord-row-conf">{i.confirmationNo}</span>
                        {i.isHighValueGuest && <span className="tag tag-status-vip">returning guest</span>}
                        <p className="coord-row-sub">
                          {i.guestNickname} · {i.disruptionTitle} · {i.roomTypeName} · {i.checkIn} → {i.checkOut}
                        </p>
                        {i.overdue && <p className="coord-row-meta">overdue — please respond soon</p>}
                      </div>
                      <div className="coord-row-actions">
                        <button type="button" className="coord-btn-link" disabled={busyId === i.id} onClick={() => void confirmInquiry(i.id)}>
                          {busyId === i.id ? "Confirming…" : "Confirm deferral"}
                        </button>
                        <button
                          type="button"
                          className="coord-btn-link"
                          onClick={() => setCustomOptionTarget({ caseId: i.caseId, confirmationNo: i.confirmationNo })}
                        >
                          + Offer custom option
                        </button>
                        <button
                          type="button"
                          className="coord-btn-link coord-btn-danger"
                          onClick={() => setRejectTarget({ kind: "inquiry", id: i.id, label: i.confirmationNo })}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Pagination page={pendingInquiriesPage.page} totalPages={pendingInquiriesPage.totalPages} onChange={pendingInquiriesPage.setPage} />

              <h3>H2 — Guest selected a rebooking plan</h3>
              {filteredPendingOptions.length === 0 ? (
                <p className="coord-empty">No pending guest selections.</p>
              ) : (
                <div className="coord-table">
                  {pendingOptionsPage.paged.map((o) => {
                    const payload = parsePayload(o.payloadJson);
                    return (
                      <div key={o.optionId} className="coord-row">
                        <div className="coord-row-main">
                          <span className="coord-row-conf">{o.confirmationNo}</span>
                          {o.isHighValueGuest && <span className="tag tag-status-vip">returning guest</span>}
                          <p className="coord-row-sub">
                            {o.guestNickname} · {o.optionType}
                            {payload.room_type ? ` · ${payload.room_type}` : ""}
                          </p>
                        </div>
                        <div className="coord-row-actions">
                          <button
                            type="button"
                            className="coord-btn-link"
                            disabled={busyId === o.optionId}
                            onClick={() => void confirmOption(o.optionId)}
                          >
                            {busyId === o.optionId ? "Confirming…" : "Confirm availability"}
                          </button>
                          <button type="button" className="coord-btn-link" onClick={() => setPerksTarget(o)}>
                            Add perks{o.perkNames.length > 0 ? ` (${o.perkNames.length})` : ""}
                          </button>
                          <button
                            type="button"
                            className="coord-btn-link"
                            onClick={() => setCustomOptionTarget({ caseId: o.caseId, confirmationNo: o.confirmationNo })}
                          >
                            + Offer custom option
                          </button>
                          <button
                            type="button"
                            className="coord-btn-link coord-btn-danger"
                            onClick={() => setRejectTarget({ kind: "option", id: o.optionId, label: o.confirmationNo })}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Pagination page={pendingOptionsPage.page} totalPages={pendingOptionsPage.totalPages} onChange={pendingOptionsPage.setPage} />
            </>
          ) : tab === "done" ? (
            <>
              <div className="coord-queue-stats">
                <div className="coord-stat-card">
                  <span className="coord-stat-label">Disruption requests answered</span>
                  <span className="coord-stat-value">{doneInquiries.length}</span>
                  <span className="coord-stat-sub">
                    {doneStats.acceptedCount} accepted · {doneStats.rejectedCount} rejected
                  </span>
                </div>
                <div className="coord-stat-card">
                  <span className="coord-stat-label">Guest selections resolved</span>
                  <span className="coord-stat-value">{doneOptions.length}</span>
                  <span className="coord-stat-sub">
                    {doneStats.availableCount} confirmed · {doneStats.unavailableCount} declined
                  </span>
                </div>
                <div className="coord-stat-card coord-stat-card-wide coord-queue-reason-card">
                  <span className="coord-stat-label">Outcome breakdown</span>
                  {doneStats.byOutcome.length === 0 ? (
                    <span className="coord-stat-sub">Nothing resolved yet — outcomes will chart here once you do.</span>
                  ) : (
                    <div className="coord-queue-reason-bars">
                      {doneStats.byOutcome.map(([label, count]) => (
                        <div key={label} className="coord-queue-reason-row">
                          <span className="coord-queue-reason-label">{label}</span>
                          <div className="coord-queue-reason-track">
                            <div className="coord-queue-reason-fill" style={{ width: `${(count / doneStats.total) * 100}%` }} />
                          </div>
                          <span className="coord-queue-reason-count">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <details className="coord-queue-tip hotel-queue-tip-collapsible">
                <summary>About this history</summary>
                <p>
                  Every disruption request and guest selection your team has resolved lives here permanently as an audit
                  trail — reject/decline reasons are kept so you can spot patterns (e.g. a room type that keeps getting
                  declined) and settle disputes with guests or coordinators later.
                </p>
              </details>

              {doneInquiries.length + doneOptions.length === 0 ? (
                <div className="hotel-caught-up">
                  <span className="hotel-caught-up-icon" aria-hidden="true">
                    🗂️
                  </span>
                  <p className="hotel-caught-up-title">No history yet</p>
                  <p className="hotel-caught-up-body">
                    Once your team answers a disruption request or resolves a guest's rebooking selection over on My
                    to-dos, it'll show up here permanently as an audit trail.
                  </p>
                  {profileSnapshot && (
                    <div className="hotel-caught-up-snapshot">
                      <div>
                        <span className="hotel-caught-up-snapshot-value">{profileSnapshot.roomTypeCount}</span>
                        <span className="hotel-caught-up-snapshot-label">room types listed</span>
                      </div>
                      <div>
                        <span className="hotel-caught-up-snapshot-value">{perks.length}</span>
                        <span className="hotel-caught-up-snapshot-label">perks available to offer</span>
                      </div>
                      <div>
                        <span className="hotel-caught-up-snapshot-value hotel-caught-up-snapshot-value-sm">{profileSnapshot.address}</span>
                        <span className="hotel-caught-up-snapshot-label">{profileSnapshot.name}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
              <h3>Answered disruption requests</h3>
              {filteredDoneInquiries.length === 0 ? (
                <p className="coord-empty">
                  {taskFilter.trim() ? "No answered requests match your filter." : "No answered requests yet."}
                </p>
              ) : (
                <div className="coord-table" style={{ marginBottom: "1.2rem" }}>
                  {doneInquiriesPage.paged.map((i) => (
                    <div key={i.id} className="coord-row">
                      <div className="coord-row-main">
                        <span className="coord-row-conf">{i.confirmationNo}</span>
                        {i.isHighValueGuest && <span className="tag tag-status-vip">returning guest</span>}
                        <p className="coord-row-sub">
                          {i.guestNickname} · {i.disruptionTitle} ·{" "}
                          <span className={`tag tag-status-${i.status === "accepted" ? "normal" : "overdue"}`}>{i.status}</span>
                          {timeAgo(i.respondedAt) && <span className="coord-row-meta"> · {timeAgo(i.respondedAt)}</span>}
                        </p>
                        {i.status === "rejected" && i.rejectReason && (
                          <p className="coord-row-meta">Reason: {i.rejectReason}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Pagination page={doneInquiriesPage.page} totalPages={doneInquiriesPage.totalPages} onChange={doneInquiriesPage.setPage} />

              <h3>Resolved guest selections</h3>
              {filteredDoneOptions.length === 0 ? (
                <p className="coord-empty">
                  {taskFilter.trim() ? "No resolved selections match your filter." : "No resolved selections yet."}
                </p>
              ) : (
                <div className="coord-table">
                  {doneOptionsPage.paged.map((o) => (
                    <div key={o.optionId} className="coord-row">
                      <div className="coord-row-main">
                        <span className="coord-row-conf">{o.confirmationNo}</span>
                        {o.isHighValueGuest && <span className="tag tag-status-vip">returning guest</span>}
                        <p className="coord-row-sub">
                          {o.guestNickname} · {o.optionType} ·{" "}
                          <span className={`tag tag-status-${o.availability === "available" ? "normal" : "overdue"}`}>
                            {o.availability === "available" ? "confirmed" : "declined"}
                          </span>
                          {timeAgo(o.selectedSince) && <span className="coord-row-meta"> · {timeAgo(o.selectedSince)}</span>}
                        </p>
                        {o.availability === "unavailable" && o.unavailableReason && (
                          <p className="coord-row-meta">Reason: {o.unavailableReason}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Pagination page={doneOptionsPage.page} totalPages={doneOptionsPage.totalPages} onChange={doneOptionsPage.setPage} />
                </>
              )}
            </>
          ) : (
            <HotelProfilePanel />
          )}
        </div>
      </div>

      {rejectTarget && (
        <RejectModal title={`Reject ${rejectTarget.label}`} onCancel={() => setRejectTarget(null)} onConfirm={(r) => void doReject(r)} />
      )}
      {perksTarget && (
        <PerksModal option={perksTarget} perks={perks} onCancel={() => setPerksTarget(null)} onConfirm={(p) => void saveOptionPerks(p)} />
      )}
      {customOptionTarget && (
        <CustomOptionModal
          confirmationNo={customOptionTarget.confirmationNo}
          perks={perks}
          onCancel={() => setCustomOptionTarget(null)}
          onConfirm={(title, p) => void offerCustomOption(title, p)}
        />
      )}
    </AppShell>
  );
}
