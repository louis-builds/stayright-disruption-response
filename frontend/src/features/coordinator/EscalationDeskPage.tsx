import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { CoordinatorTopNav } from "../../shared/components/CoordinatorTopNav";
import { useAuth } from "../auth";
import * as caseApi from "../cases/api";
import type { CaseSummary } from "../cases/types";
import * as api from "./api";
import type { AdminOption, CaseNotification, RefundStatus } from "./types";
import "./EscalationDeskPage.css";

const DECISION_TYPES = [
  { value: "改订成功结案", label: "Rebooking succeeded" },
  { value: "取消退款完成结案", label: "Cancel & refund" },
  { value: "维持原订", label: "Keep original booking" },
  { value: "人工决议结案", label: "Other manual resolution" },
];

function OptionSnapshot({ option }: { option: AdminOption }) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(option.payloadJson) as Record<string, unknown>;
  } catch {
    // leave empty
  }
  return (
    <div className="escalation-option-snapshot">
      <div className="option-admin-header">
        <h4>{option.optionType}</h4>
        <span className={`tag tag-status-${option.availability === "unavailable" ? "overdue" : "normal"}`}>{option.availability}</span>
      </div>
      {option.availability === "unavailable" ? (
        <p className="option-admin-reason">Unavailable: {option.unavailableReason}</p>
      ) : (
        <ul className="escalation-snapshot-fields">
          {Object.entries(payload).map(([k, v]) => (
            <li key={k}>
              {k.replace(/_/g, " ")}: {String(v)}
            </li>
          ))}
        </ul>
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
    await api.confirmRefund(caseId, amount, description.trim());
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

  const canClose = !isRefund || refundStatus?.confirmed;

  return (
    <AppShell centerContent={<CoordinatorTopNav activeTab="queue" />} showBack>
      <div className="escalation-desk">
        <button type="button" className="coord-btn-link" onClick={() => navigate(`/cases/${caseId}`)}>
          ← Open conversation with guest
        </button>

        {loading ? (
          <p className="coord-empty">Loading…</p>
        ) : (
          <>
            {caseSummary && (
              <div className="escalation-header">
                <div>
                  <h2>{caseSummary.hotelName} — {caseSummary.disruptionTitle}</h2>
                  <p className="coord-row-sub">
                    {caseSummary.checkIn} → {caseSummary.checkOut} · priority {caseSummary.priority} · status {caseSummary.statusLabel}
                  </p>
                </div>
                {syncedAt && (
                  <p className="coord-sync-indicator escalation-sync">
                    <span className="coord-sync-dot" aria-hidden="true" />
                    Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
                  </p>
                )}
              </div>
            )}

            <div className="escalation-desk-layout">
            <div className="escalation-desk-main">
            <div className="escalation-section">
              <h3>Options already pushed to the guest (and their availability)</h3>
              {options.length === 0 ? (
                <p className="coord-empty">No options were generated for this case.</p>
              ) : (
                <div className="escalation-snapshot-grid">
                  {options.map((o) => (
                    <OptionSnapshot key={o.id} option={o} />
                  ))}
                </div>
              )}
            </div>

            <div className="escalation-section">
              <h3>Notifications sent for this case</h3>
              {notifications.length === 0 ? (
                <p className="coord-empty">No notifications yet.</p>
              ) : (
                <div className="coord-table">
                  {notifications.map((n) => (
                    <div key={n.id} className="coord-row">
                      <div className="coord-row-main">
                        <p className="coord-row-conf">
                          {n.title} <span className="coord-row-meta">({n.channel})</span>
                        </p>
                        <p className="coord-row-sub">{n.body}</p>
                      </div>
                      <div className="coord-row-actions">
                        <span className={`tag tag-status-${n.success ? "normal" : "overdue"}`}>{n.success ? "sent" : "failed"}</span>
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
            </div>
            </div>

            <div className="escalation-desk-side">
            <div className="escalation-section">
              <h3>Final decision</h3>
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
    </AppShell>
  );
}
