import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import * as caseApi from "../cases/api";
import type { CaseSummary } from "../cases/types";
import * as api from "./api";
import type { AdminOption, PushOptionsStatus } from "./types";
import { CoordinatorDashboardShell } from "./CoordinatorDashboardShell";
import "./OptionsAdminPage.css";

const OPTION_TITLES: Record<string, string> = {
  defer: "Defer & keep original hotel",
  alternate: "Move to an alternative stay",
  cancel: "Cancel & refund",
};
const OPTION_DESCRIPTIONS: Record<string, string> = {
  defer: "Shift reservation dates while keeping the original hotel.",
  alternate: "Relocate the guest to a suitable partner hotel.",
  cancel: "Cancel the booking and review the refund details.",
};
const OPTION_ICONS: Record<string, string> = { defer: "◷", alternate: "▣", cancel: "$" };

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function addDaysToDate(dateValue: string | null, days: number): string | null {
  if (!dateValue || !Number.isFinite(days)) return null;
  const parts = dateValue.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatStoredDate(dateValue: string | null): string | null {
  return addDaysToDate(dateValue, 0);
}

function UnavailableModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Mark unavailable</h3>
        <label className="coord-field">
          <span>Reason (required)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. hotel declined to hold rooms" />
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function UnlockModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Unlock option</h3>
        <label className="coord-field">
          <span>Reason (required)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="coord-btn-primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Confirm unlock
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionCard({ option, caseId, readOnly, caseClosed, bookingCheckIn, bookingCheckOut, onChanged }: {
  option: AdminOption;
  caseId: string;
  readOnly: boolean;
  caseClosed: boolean;
  bookingCheckIn: string | null;
  bookingCheckOut: string | null;
  onChanged: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const parsed = parsePayload(option.payloadJson);
    setFields(Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")])));
  }, [option.payloadJson]);

  async function save() {
    setSaving(true);
    const payload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      payload[k] = v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v;
    }
    await api.updateOptionPayload(caseId, option.id, payload);
    setSaving(false);
    onChanged();
  }

  const showConcreteDeferDates = readOnly && option.optionType === "defer";
  const checkInOffset = Number(fields.new_check_in_offset_days);
  const checkOutOffset = Number(fields.new_check_out_offset_days);
  const concreteCheckIn = caseClosed
    ? formatStoredDate(bookingCheckIn)
    : addDaysToDate(bookingCheckIn, checkInOffset);
  const concreteCheckOut = caseClosed
    ? formatStoredDate(bookingCheckOut)
    : addDaysToDate(bookingCheckIn, checkOutOffset);

  return (
    <div className={`option-admin-card ${option.availability === "unavailable" ? "option-admin-card-unavailable" : ""}`}>
      <div className="option-admin-header">
        <div className="option-admin-title"><i>{OPTION_ICONS[option.optionType] ?? "◇"}</i><div><h3>{option.optionType === "custom" ? (option.customTitle ?? "Custom option") : (OPTION_TITLES[option.optionType] ?? option.optionType)}</h3><p>{OPTION_DESCRIPTIONS[option.optionType] ?? "Coordinator-created option for this case."}</p></div></div>
        <div className="option-admin-tags">
          <span className={`tag tag-status-${option.availability === "unavailable" ? "overdue" : "normal"}`}>{option.executionRequestedAt ? "guest submitted" : option.availability}</span>
          {option.locked && <span className="tag tag-status-warn">locked</span>}
        </div>
      </div>
      {option.perkNames.length > 0 && <p className="option-admin-reason">Perks: {option.perkNames.join(", ")}</p>}

      {option.optionType === "cancel" && !readOnly && (
        <div className="option-admin-visibility">
          <span className="option-admin-visibility-label">Show to guest</span>
          <div className="option-admin-visibility-toggle">
            {(["auto", "show", "hide"] as const).map((mode) => {
              const value = mode === "auto" ? null : mode === "show";
              const active = option.coordinatorVisibilityOverride === value;
              return (
                <button
                  key={mode}
                  type="button"
                  className={`option-admin-visibility-btn ${active ? "option-admin-visibility-btn-active" : ""}`}
                  onClick={() => void api.setOptionVisibility(caseId, option.id, value).then(onChanged)}
                >
                  {mode === "auto" ? "Auto" : mode === "show" ? "Show" : "Hide"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {option.availability === "unavailable" ? (
        <p className="option-admin-reason">Unavailable: {option.unavailableReason}</p>
      ) : (
        <div className="option-admin-fields">
          {Object.entries(fields)
            .filter(([key]) => !showConcreteDeferDates || !["new_check_in_offset_days", "new_check_out_offset_days"].includes(key))
            .map(([key, value]) => (
            <label key={key} className="coord-field">
              <span>{key.replace(/_/g, " ")}</span>
              <input
                value={value}
                disabled={option.locked || readOnly}
                onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </label>
          ))}
          {showConcreteDeferDates && (
            <>
              <label className="coord-field">
                <span>New check-in date</span>
                <input value={concreteCheckIn ?? "Date unavailable"} disabled />
              </label>
              <label className="coord-field">
                <span>New check-out date</span>
                <input value={concreteCheckOut ?? "Date unavailable"} disabled />
              </label>
            </>
          )}
        </div>
      )}

      <div className="option-admin-actions">
        {readOnly ? (
          <span className="coord-row-meta">{caseClosed ? "Case closed — read-only" : "Guest submitted — read-only"}</span>
        ) : (
          <>
            {option.availability !== "unavailable" && (
              <button type="button" className="coord-btn-secondary" disabled={option.locked || saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save fields"}
              </button>
            )}
            {option.locked ? (
              <button type="button" className="coord-btn-secondary" onClick={() => setShowUnlock(true)}>
                Unlock
              </button>
            ) : (
              <button type="button" className="coord-btn-secondary" onClick={() => void api.lockOption(caseId, option.id).then(onChanged)}>
                Lock
              </button>
            )}
            {option.availability !== "unavailable" && (
              <button type="button" className="coord-btn-link coord-btn-danger" onClick={() => setShowUnavailable(true)}>
                Mark unavailable
              </button>
            )}
          </>
        )}
      </div>

      {showUnavailable && (
        <UnavailableModal
          onCancel={() => setShowUnavailable(false)}
          onConfirm={(reason) => {
            void api.markOptionUnavailable(caseId, option.id, reason).then(() => {
              setShowUnavailable(false);
              onChanged();
            });
          }}
        />
      )}
      {showUnlock && (
        <UnlockModal
          onCancel={() => setShowUnlock(false)}
          onConfirm={(reason) => {
            void api.unlockOption(caseId, option.id, reason).then(() => {
              setShowUnlock(false);
              onChanged();
            });
          }}
        />
      )}
    </div>
  );
}

export function OptionsAdminPage() {
  const { id } = useParams<{ id: string }>();
  const caseId = id!;
  const { user } = useAuth();
  const navigate = useNavigate();
  const [caseSummary, setCaseSummary] = useState<CaseSummary | null>(null);
  const [options, setOptions] = useState<AdminOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushResult, setPushResult] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushOptionsStatus | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  // refresh()(挂载+每次锁定/解锁/标记不可用/存字段/重新生成之后都会调用)和 30 秒轮询打的是同一组
  // 接口、互相之间没有任何先后顺序保证——亲测复现过:协调员点了 Lock,refresh() 很快把这张卡片
  // 更新成 locked(正确),但紧接着一个更早发出、这时才姗姗来迟落地的轮询响应(里面还是锁定前的
  // 旧数据)会把这张卡片悄悄改回 unlocked。发起这两处请求前都领一个新序号，落地时只有序号还是
  // 当前最新的那个才允许真的写 state。
  const latestRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    const [caseRes, optionsRes, pushStatusRes] = await Promise.all([caseApi.fetchCase(caseId), api.fetchAdminOptions(caseId), api.fetchPushOptionsStatus(caseId)]);
    if (requestId === latestRequestIdRef.current) {
      if (caseRes.code === 0) setCaseSummary(caseRes.data);
      if (optionsRes.code === 0) setOptions(optionsRes.data);
      if (pushStatusRes.code === 0) setPushStatus(pushStatusRes.data);
      setLoading(false);
      setSyncedAt(new Date());
    }
  }, [caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 酒店那边随时可能确认/拒绝某个方案，别的协调员也可能在同一个案件上动手——静默轮询，
  // 不摸 loading(避免正在编辑字段的输入框被整页刷新打断)。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const requestId = ++latestRequestIdRef.current;
      void Promise.all([caseApi.fetchCase(caseId), api.fetchAdminOptions(caseId), api.fetchPushOptionsStatus(caseId)]).then(([caseRes, optionsRes, pushStatusRes]) => {
        if (requestId === latestRequestIdRef.current) {
          if (caseRes.code === 0) setCaseSummary(caseRes.data);
          if (optionsRes.code === 0) setOptions(optionsRes.data);
          if (pushStatusRes.code === 0) setPushStatus(pushStatusRes.data);
          setSyncedAt(new Date());
        }
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [caseId]);

  async function regenerate() {
    setRegenerating(true);
    await api.regenerateOptions(caseId);
    setRegenerating(false);
    await refresh();
  }

  async function push() {
    setPushing(true);
    const res = await api.pushOptions(caseId);
    setPushing(false);
    if (res.code === 0) {
      setPushResult(res.data.success ? "Pushed to guest successfully." : "Push recorded but the email failed to send — flagged for retry.");
      await refresh();
    } else {
      setPushResult(res.message);
      await refresh();
    }
  }

  const submittedOption = options.find((option) => option.selected && option.executionRequestedAt) ?? null;
  const optionTypeOrder: Record<string, number> = { defer: 0, alternate: 1, cancel: 2, custom: 3 };
  const displayedOptions = [...(submittedOption ? [submittedOption] : options)].sort(
    (a, b) => (optionTypeOrder[a.optionType] ?? 99) - (optionTypeOrder[b.optionType] ?? 99) || a.createdAt.localeCompare(b.createdAt),
  );
  const selectionSubmitted = submittedOption !== null;
  const allUnavailable = displayedOptions.length > 0 && displayedOptions.every((o) => o.availability === "unavailable");
  const isClosed = caseSummary?.status === "closed";
  const awaitingHotelConfirmation = Boolean(
    !isClosed && submittedOption &&
    (submittedOption.optionType === "defer" || submittedOption.optionType === "alternate") &&
    submittedOption.availability === "pending",
  );

  if (!user) return null;

  const availableCount = displayedOptions.filter((option) => option.availability !== "unavailable").length;

  const workspace = (
      <div className="options-workspace">
        <div className="options-workspace-topline">
          <button type="button" className="options-workspace-back" onClick={() => navigate(`/cases/${caseId}`)}>
            ← Back to Case Workspace (CASE-{caseId.slice(0, 8).toUpperCase()})
          </button>
          <div className="options-workspace-sync">
            <i aria-hidden="true" />
            {syncedAt ? `Synced ${syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s` : "Syncing…"}
          </div>
        </div>

        {caseSummary && (
          <section className="options-case-strip">
            <div><small>Guest</small><strong><i className="options-summary-icon">♙</i>{caseSummary.guestNickname ?? "Guest not recorded"}</strong><span>{caseSummary.confirmationNo ?? "No booking reference"}</span></div>
            <div><small>Hotel</small><strong><i className="options-summary-icon">▦</i>{caseSummary.hotelName ?? "Not recorded"}</strong><span>{caseSummary.checkIn && caseSummary.checkOut ? `▣ ${caseSummary.checkIn} → ${caseSummary.checkOut}` : "Dates not recorded"}</span></div>
            <div><small>Disruption</small><strong><i className="options-summary-icon warning">△</i>{caseSummary.disruptionTitle ?? "Not recorded"}</strong><span className="options-summary-priority">● {caseSummary.priority} priority</span></div>
            <div><small>{selectionSubmitted ? "Confirmed option" : "Available options"}</small><strong className="options-count">{availableCount}</strong><span>{selectionSubmitted ? "submitted by guest" : `${options.length} generated`}</span></div>
          </section>
        )}

        <div className="options-admin-layout">
      <div className="options-admin">
        {allUnavailable && (
          <div className="options-admin-alert">
            All options are unavailable — this case has been escalated to the human upgrade queue.
          </div>
        )}

        {isClosed && (
          <div className="options-admin-closed-note">
            This case is closed — the options below are a read-only record of what was offered. Nothing here can be edited, locked, regenerated, or re-pushed.
          </div>
        )}

        {selectionSubmitted && !isClosed && (
          <div className="options-admin-closed-note">
            {awaitingHotelConfirmation
              ? "The guest has selected this option. The booking will remain unchanged until the hotel confirms availability."
              : "The guest has submitted this option. It is now read-only and ready for final processing."}
          </div>
        )}

        <div className="options-section-heading">
          <div><h2>{selectionSubmitted ? "Guest confirmed option" : "Generated options"}</h2><p>{selectionSubmitted ? "Only the guest’s final submitted choice is shown." : "Edit only the details that require coordinator review."}</p></div>
          <div className="coord-toolbar">
          {isClosed ? (
            <button type="button" className="coord-btn-primary" onClick={() => navigate(`/coordinator/cases/${caseId}/escalation`)}>
              View completed case →
            </button>
          ) : awaitingHotelConfirmation ? (
            <button type="button" className="coord-btn-secondary" disabled>
              Awaiting hotel confirmation
            </button>
          ) : selectionSubmitted ? (
            <button type="button" className="coord-btn-primary" onClick={() => navigate(`/coordinator/cases/${caseId}/escalation`)}>
              Continue to case decision →
            </button>
          ) : (
            <>
              <button type="button" className="coord-btn-secondary" disabled={regenerating || selectionSubmitted} onClick={() => void regenerate()}>
                {regenerating ? "Regenerating…" : "Regenerate unlocked options"}
              </button>
              <button type="button" className="coord-btn-primary" disabled={pushing || options.length === 0 || pushStatus?.canPush === false} onClick={() => void push()}>
                {pushing ? "Pushing…" : pushStatus?.state === "guest_confirmed" ? "Guest choice submitted" : pushStatus?.state === "sent" ? "Sent to guest" : pushStatus?.state === "updated" ? "Send updated options" : pushStatus?.state === "retry" ? "Retry sending" : "Push options to guest"}
              </button>
            </>
          )}
          </div>
        </div>
        {pushResult && <p className="options-admin-push-result">{pushResult}</p>}

        {loading ? (
          <p className="coord-empty">Loading…</p>
        ) : displayedOptions.length === 0 ? (
          <p className="coord-empty">No options for this case.</p>
        ) : (
          <div className="option-admin-grid">
            {displayedOptions.map((o) => (
              <OptionCard
                key={o.id}
                option={o}
                caseId={caseId}
                readOnly={Boolean(isClosed || selectionSubmitted)}
                caseClosed={Boolean(isClosed)}
                bookingCheckIn={caseSummary?.checkIn ?? null}
                bookingCheckOut={caseSummary?.checkOut ?? null}
                onChanged={() => void refresh()}
              />
            ))}
          </div>
        )}
      </div>

      {caseSummary && (
        <aside className="options-admin-side">
          <div className="options-admin-side-card">
            <div className="options-side-heading"><h3>Case details</h3><span>REF: #{caseSummary.confirmationNo ?? caseId.slice(0, 8).toUpperCase()}</span></div>
            <dl className="options-admin-side-list">
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`tag tag-status tag-status-${caseSummary.status}`}>{caseSummary.statusLabel}</span>
                </dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd className="options-admin-priority">{caseSummary.priority}</dd>
              </div>
              <div>
                <dt>Options</dt>
                <dd>
                  {selectionSubmitted ? "Guest submitted 1 option" : `${availableCount} available / ${options.length} total`}
                </dd>
              </div>
            </dl>
            <button type="button" className="options-admin-chat-btn" onClick={() => navigate(`/cases/${caseId}`)}>
              Open case conversation →
            </button>
          </div>
          <div className="options-review-guide"><h3><span>♢</span> Review Guidelines</h3><ul><li>Lock options to prevent automated updates during review.</li><li>Hide “Cancel & refund” when it is not suitable for the guest.</li><li>Push only after checking hotel, dates, fees and availability.</li></ul></div>
        </aside>
      )}
      </div>
      </div>
  );

  return (
    <CoordinatorDashboardShell
      user={user}
      active="reports"
      onNavigate={() => navigate("/coordinator/home")}
      onSearch={() => navigate("/coordinator/home")}
    >
      {workspace}
    </CoordinatorDashboardShell>
  );
}
