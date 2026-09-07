import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import * as caseApi from "../cases/api";
import type { CaseSummary } from "../cases/types";
import * as api from "./api";
import type { AdminOption, CaseNotification, RefundStatus } from "./types";
import { CoordinatorDashboardShell } from "./CoordinatorDashboardShell";
import "./EscalationDeskPage.css";

const DECISION_TYPES = [
  { value: "改订成功结案", label: "Rebooking succeeded" },
  { value: "取消退款完成结案", label: "Cancel & refund" },
  { value: "维持原订", label: "Keep original booking" },
  { value: "人工决议结案", label: "Other manual resolution" },
];

const OPTION_META: Record<string, { title: string; description: string; icon: string }> = {
  defer: { title: "Defer stay", description: "Move the stay dates while keeping the original hotel.", icon: "◷" },
  alternate: { title: "Alternative stay", description: "Relocate the guest to an available partner hotel.", icon: "▣" },
  cancel: { title: "Cancel & refund", description: "Cancel the booking and return the eligible amount.", icon: "▤" },
};
const FIELD_LABELS: Record<string, string> = {
  hotel: "Alternative hotel", room_type: "Room type", fee_diff: "Price difference", currency: "Currency",
  distance_km: "Distance", refund_amount: "Refund total", cancellation_fee: "Cancellation fee",
  eta_business_days: "Estimated payout", new_check_in_offset_days: "New check-in offset",
  new_check_out_offset_days: "New check-out offset",
};

function formatOptionValue(key: string, value: unknown) {
  if (key === "distance_km") return `${value} km`;
  if (key === "eta_business_days") return `${value} business days`;
  if (key.includes("offset_days")) return `+${value} days`;
  return String(value);
}

function OptionSnapshot({ option }: { option: AdminOption }) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(option.payloadJson) as Record<string, unknown>;
  } catch {
    // leave empty
  }
  const meta = OPTION_META[option.optionType] ?? { title: option.customTitle ?? "Custom option", description: "Coordinator-reviewed option.", icon: "◇" };
  const visibleFields = Object.entries(payload).filter(([key]) => key !== "hotel_id");
  return (
    <div className="escalation-option-snapshot">
      <div className="option-admin-header">
        <div className="escalation-option-title"><i>{meta.icon}</i><div><h4>{meta.title}</h4><p>{meta.description}</p></div></div>
        <span className={`tag tag-status-${option.availability === "unavailable" ? "overdue" : "normal"}`}>
          {option.executionRequestedAt && option.availability === "pending" && (option.optionType === "defer" || option.optionType === "alternate")
            ? "awaiting hotel"
            : option.executionRequestedAt ? "guest submitted" : option.availability}
        </span>
      </div>
      {option.availability === "unavailable" ? (
        <p className="option-admin-reason">Unavailable: {option.unavailableReason}</p>
      ) : (
        <dl className="escalation-snapshot-fields">
          {visibleFields.map(([k, v]) => (
            <div key={k}>
              <dt>{FIELD_LABELS[k] ?? k.replace(/_/g, " ")}</dt><dd>{formatOptionValue(k, v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function EscalationDeskPage() {
  const { id } = useParams<{ id: string }>();
  const caseId = id!;
  const { user } = useAuth();
  const navigate = useNavigate();

  const [caseSummary, setCaseSummary] = useState<CaseSummary | null>(null);
  const [options, setOptions] = useState<AdminOption[]>([]);
  const [notifications, setNotifications] = useState<CaseNotification[]>([]);
  const [notificationPage, setNotificationPage] = useState(1);
  const [refundStatus, setRefundStatus] = useState<RefundStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [decisionType, setDecisionType] = useState(DECISION_TYPES[0].value);
  const [description, setDescription] = useState("");
  const [feeOutcome, setFeeOutcome] = useState("");
  const [confirmingRefund, setConfirmingRefund] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  // refresh()(挂载+每次确认退款/结案/重发通知之后都会调用)和 30 秒轮询打的是同一组接口、
  // 互相之间没有任何先后顺序保证——亲测复现过:协调员点了 Resend,refresh() 很快把这条通知
  // 更新成 sent(正确),但紧接着一个更早发出、这时才姗姗来迟落地的轮询响应(里面还是重发前的
  // 旧数据)会把这一行悄悄改回 failed、Resend 按钮也跟着重新冒出来。发起这两处请求前都领一个新
  // 序号，落地时只有序号还是当前最新的那个才允许真的写 state。
  const latestRequestIdRef = useRef(0);

  const isRefund = decisionType === "取消退款完成结案";

  const refresh = useCallback(async () => {
    setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    const [caseRes, optionsRes, notifRes, refundRes] = await Promise.all([
      caseApi.fetchCase(caseId),
      api.fetchAdminOptions(caseId),
      api.fetchCaseNotifications(caseId),
      api.fetchRefundStatus(caseId),
    ]);
    if (requestId === latestRequestIdRef.current) {
      if (caseRes.code === 0) setCaseSummary(caseRes.data);
      if (optionsRes.code === 0) setOptions(optionsRes.data);
      if (notifRes.code === 0) setNotifications(notifRes.data);
      if (refundRes.code === 0) setRefundStatus(refundRes.data);
      setLoading(false);
      setSyncedAt(new Date());
    }
  }, [caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 案件关闭前这段时间,酒店可能确认/拒绝方案、新通知会进来——静默轮询,不摸 loading
  // (避免正在填的决定描述/退款金额被整页刷新打断)。案件一旦关闭这页也就没什么好轮询的了,但
  // 多轮询几次不影响正确性,懒得为"关闭后停止"这种边界单独判断。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const requestId = ++latestRequestIdRef.current;
      void Promise.all([
        caseApi.fetchCase(caseId),
        api.fetchAdminOptions(caseId),
        api.fetchCaseNotifications(caseId),
        api.fetchRefundStatus(caseId),
      ]).then(([caseRes, optionsRes, notifRes, refundRes]) => {
        if (requestId === latestRequestIdRef.current) {
          if (caseRes.code === 0) setCaseSummary(caseRes.data);
          if (optionsRes.code === 0) setOptions(optionsRes.data);
          if (notifRes.code === 0) setNotifications(notifRes.data);
          if (refundRes.code === 0) setRefundStatus(refundRes.data);
          setSyncedAt(new Date());
        }
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [caseId]);

  async function confirmRefund() {
    const amount = Number(feeOutcome);
    if (!amount || !description.trim()) return;
    setConfirmingRefund(true);
    setError(null);
    await api.confirmRefund(caseId, amount, description.trim(), submittedOption?.id ?? null);
    setConfirmingRefund(false);
    await refresh();
  }

  async function submitDecision() {
    if (!description.trim()) return;
    setClosing(true);
    setError(null);
    setResultMsg(null);
    const res = await api.closeCase(caseId, decisionType, description.trim());
    setClosing(false);
    if (res.code !== 0) {
      setError(res.message);
      return;
    }
    setResultMsg("Case resolved and results sent to guest and hotel.");
    await refresh();
  }

  async function resend(notificationId: string) {
    await api.resendNotification(notificationId);
    await refresh();
  }

  if (!user) return null;

  const optionOrder: Record<string, number> = { alternate: 0, defer: 1, cancel: 2, custom: 3 };
  const orderedOptions = [...options].sort((a, b) => (optionOrder[a.optionType] ?? 9) - (optionOrder[b.optionType] ?? 9));
  const submittedOption = orderedOptions.find((option) => option.selected && option.executionRequestedAt) ?? null;
  const displayedOptions = submittedOption ? [submittedOption] : orderedOptions;
  const awaitingHotelConfirmation = Boolean(
    caseSummary?.status !== "closed" && submittedOption &&
    (submittedOption.optionType === "defer" || submittedOption.optionType === "alternate") &&
    submittedOption.availability === "pending",
  );
  const canClose = (!isRefund || Boolean(refundStatus?.confirmed)) && !awaitingHotelConfirmation;
  const notificationsPerPage = 5;
  const orderedNotifications = [...notifications].sort((a, b) => {
    const aTime = new Date(a.sentAt).getTime();
    const bTime = new Date(b.sentAt).getTime();
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });
  const notificationPageCount = Math.max(1, Math.ceil(orderedNotifications.length / notificationsPerPage));
  const currentNotificationPage = Math.min(notificationPage, notificationPageCount);
  const notificationStart = (currentNotificationPage - 1) * notificationsPerPage;
  const visibleNotifications = orderedNotifications.slice(notificationStart, notificationStart + notificationsPerPage);

  return (
    <CoordinatorDashboardShell user={user} active="reports" onNavigate={() => navigate("/coordinator/home")} onSearch={() => navigate("/coordinator/home")}>
      <div className="escalation-workspace">
      <div className="escalation-desk">
        <div className="escalation-topline"><button type="button" className="coord-btn-link" onClick={() => navigate(`/cases/${caseId}`)}>← Coordinator Options&nbsp; / &nbsp;<strong>Case Decision</strong></button>{syncedAt && <p className="coord-sync-indicator escalation-sync"><span className="coord-sync-dot" aria-hidden="true" />Last sync {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · auto-refreshes every 30s</p>}</div>

        {loading ? (
          <p className="coord-empty">Loading…</p>
        ) : (
          <>
            {caseSummary && (
              <div className="escalation-header">
                <div className="escalation-case-title"><div className="escalation-header-badges"><span>CASE-{caseId.slice(0, 8).toUpperCase()}</span><em className={`priority-${caseSummary.priority}`}>{caseSummary.priority} priority</em><em className={`status-${caseSummary.status}`}>{caseSummary.statusLabel}</em></div><h1>{caseSummary.hotelName ?? "Hotel not recorded"} — {caseSummary.disruptionTitle ?? "Disruption case"}</h1></div>
                <dl><div><dt>Hotel partner</dt><dd>▦ {caseSummary.hotelName ?? "Not recorded"}</dd></div><div><dt>Guest</dt><dd>♙ {caseSummary.guestNickname ?? "Guest not recorded"}</dd></div><div><dt>Booking reference</dt><dd>▣ {caseSummary.confirmationNo ?? "Not recorded"}</dd></div><div><dt>Stay dates</dt><dd>▤ {caseSummary.checkIn && caseSummary.checkOut ? `${caseSummary.checkIn} → ${caseSummary.checkOut}` : "Not recorded"}</dd></div></dl>
              </div>
            )}

            <div className="escalation-desk-layout">
            <div className="escalation-desk-main">
            <div className="escalation-section">
              <div className="escalation-section-heading"><div><h3>{submittedOption ? "Guest Confirmed Option" : "Options Shared with Guest"}</h3><p>{submittedOption ? "The guest’s final submitted choice for coordinator processing." : "Current recovery proposals and their latest availability."}</p></div><span>{displayedOptions.length} {displayedOptions.length === 1 ? "option" : "options"}</span></div>
              {options.length === 0 ? (
                <p className="coord-empty">No options were generated for this case.</p>
              ) : (
                <div className="escalation-snapshot-grid">
                  {displayedOptions.map((o) => (
                    <OptionSnapshot key={o.id} option={o} />
                  ))}
                </div>
              )}
            </div>

            <div className="escalation-section">
              <div className="escalation-section-heading"><div><h3>Communication &amp; Notification History</h3><p>Chronological delivery record for this case.</p></div><span>{notifications.length} events</span></div>
              {notifications.length === 0 ? (
                <p className="coord-empty">No notifications yet.</p>
              ) : (
                <div className="coord-table">
                  {visibleNotifications.map((n) => (
                    <div key={n.id} className="coord-row">
                      <div className="coord-row-main">
                        <p className="coord-row-conf">{n.title} <span className="coord-row-meta">via {n.channel}</span></p>
                        <p className="coord-row-sub">{n.body}</p>
                      </div>
                      <div className="coord-row-actions">
                        <time className="escalation-notification-time">{new Date(n.sentAt).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span className={`tag tag-status-${n.success ? "normal" : "overdue"}`}>{n.success ? "sent" : "failed"}</span>
                        {!n.success && (
                          <button type="button" className="coord-btn-link" onClick={() => void resend(n.id)}>
                            Resend
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {notifications.length > notificationsPerPage && (
                <div className="escalation-history-pagination">
                  <p>
                    Showing {notificationStart + 1}–{Math.min(notificationStart + notificationsPerPage, notifications.length)} of {notifications.length}
                  </p>
                  <div>
                    <button type="button" disabled={currentNotificationPage === 1} onClick={() => setNotificationPage((page) => Math.max(1, page - 1))}>
                      Previous
                    </button>
                    <span>{currentNotificationPage} / {notificationPageCount}</span>
                    <button type="button" disabled={currentNotificationPage === notificationPageCount} onClick={() => setNotificationPage((page) => Math.min(notificationPageCount, page + 1))}>
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
            </div>

            <div className="escalation-desk-side">
            <div className="escalation-section">
              <div className="escalation-final-heading"><div><h3>Final Decision</h3><p>Confirm the outcome and close this case.</p></div><span>CASE-{caseId.slice(0, 8).toUpperCase()}</span></div>
              {/* resultMsg/error render outside the closed/open branch on purpose: submitDecision()
                  sets resultMsg then immediately awaits refresh(), which flips caseSummary.status to
                  "closed" — if the message lived inside the "not yet closed" branch below, that
                  branch swap would unmount it before the browser ever painted it, so the coordinator
                  got zero visible confirmation that the close actually went through. Verified live:
                  polling every 50ms showed the message never rendered, not even briefly. */}
              {error && <p className="flow-error">{error}</p>}
              {resultMsg && <p className="escalation-refund-confirmed">{resultMsg}</p>}
              {caseSummary?.status === "closed" ? (
                <p className="coord-empty">This case is already closed.</p>
              ) : awaitingHotelConfirmation ? (
                <p className="coord-empty">The guest has selected this option. Final resolution will become available after the hotel confirms it.</p>
              ) : (
                <>
                  <label className="coord-field">
                    <span>Decision type</span>
                    <select value={decisionType} onChange={(e) => setDecisionType(e.target.value)}>
                      {DECISION_TYPES.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="coord-field">
                    <span>Decision description (required)</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                  </label>
                  {isRefund && (
                    <label className="coord-field">
                      <span>Refund amount (required for refund decisions)</span>
                      <input value={feeOutcome} onChange={(e) => setFeeOutcome(e.target.value)} type="number" step="0.01" />
                    </label>
                  )}

                  {isRefund && !refundStatus?.confirmed && (
                    <button
                      type="button"
                      className="coord-btn-secondary"
                      disabled={confirmingRefund || !feeOutcome || !description.trim()}
                      onClick={() => void confirmRefund()}
                    >
                      {confirmingRefund ? "Confirming…" : "Step 1: Confirm refund amount"}
                    </button>
                  )}
                  {isRefund && refundStatus?.confirmed && (
                    <p className="escalation-refund-confirmed">
                      Refund confirmed: {refundStatus.amount} on {refundStatus.confirmedAt}
                    </p>
                  )}

                  <button
                    type="button"
                    className="coord-btn-primary"
                    disabled={!canClose || closing || !description.trim()}
                    onClick={() => void submitDecision()}
                  >
                    {closing ? "Submitting…" : "Step 2: Close case with this decision"}
                  </button>
                </>
              )}
            </div>
            </div>
            </div>
          </>
        )}
      </div>
      </div>
    </CoordinatorDashboardShell>
  );
}
