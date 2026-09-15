import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { RoleTopNav } from "../../shared/components/RoleTopNav";
import { useAuth } from "../auth";
import { GuestDashboardShell } from "../home/GuestDashboardShell";
import { HotelDashboardShell } from "../hotel/HotelDashboardShell";
import * as api from "./api";
import type { CaseOption, CaseSummary, ConfirmExecutionResult, OptionType, PolicySummary } from "./types";
import "./OptionsFlowPage.css";
import "../coordinator/CoordinatorHomePage.css";

interface OptionPayload {
  hotel?: string;
  room_type?: string;
  fee_diff?: number;
  currency?: string;
  distance_km?: number;
  reason?: string;
  room_description?: string;
  room_amenities?: string[];
  room_image_urls?: string[];
  refund_amount?: number;
  cancellation_fee?: number;
  eta_business_days?: number;
  new_check_in_offset_days?: number;
  new_check_out_offset_days?: number;
}

function parsePayload(json: string): OptionPayload {
  try {
    return JSON.parse(json) as OptionPayload;
  } catch {
    return {};
  }
}

function addDaysToDate(dateStr: string, days: number): string {
  // 不能用 new Date(dateStr + "T00:00:00").toISOString() 这套——那是本地时区午夜，
  // toISOString() 转 UTC 时在 UTC+ 时区(比如新西兰)会跨天减一天，日期整体偏移。
  // 全程用 Date.UTC 构造，不经过本地时区换算。
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function ProposeDatesModal({ defaultCheckIn, defaultCheckOut, onCancel, onConfirm }: {
  defaultCheckIn: string; defaultCheckOut: string; onCancel: () => void; onConfirm: (checkIn: string, checkOut: string) => void;
}) {
  const [checkIn, setCheckIn] = useState(defaultCheckIn);
  const [checkOut, setCheckOut] = useState(defaultCheckOut);

  return (
    <div className="coord-modal-backdrop">
      <div className="coord-modal">
        <h3>Propose different dates</h3>
        <p className="flow-hint">Not happy with the dates we suggested? Propose your own — we'll ask the hotel to reconfirm.</p>
        <label className="coord-field">
          <span>New check-in</span>
          <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </label>
        <label className="coord-field">
          <span>New check-out</span>
          <input type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} />
        </label>
        <div className="coord-modal-actions">
          <button type="button" className="coord-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="coord-btn-primary"
            disabled={!checkIn || !checkOut || checkOut <= checkIn}
            onClick={() => onConfirm(checkIn, checkOut)}
          >
            Send to hotel
          </button>
        </div>
      </div>
    </div>
  );
}

const OPTION_TITLES: Record<Exclude<OptionType, "custom">, string> = {
  defer: "Defer & keep original hotel",
  alternate: "Move to an alternative stay",
  cancel: "Cancel & refund",
};

const OPTION_DESCRIPTIONS: Record<Exclude<OptionType, "custom">, string> = {
  defer: "Move your stay dates while keeping the original hotel.",
  alternate: "Relocate to a suitable partner hotel.",
  cancel: "Cancel this booking and review the refund details.",
};

function OptionIcon({ type }: { type: OptionType }) {
  if (type === "alternate") {
    return <svg viewBox="0 0 24 24"><path d="M5 20.25V7.75h14v12.5M3 20.25h18M8 11h2M14 11h2M8 15h2M14 15h2M9 7.75v-3h6v3" /></svg>;
  }
  if (type === "defer") {
    return <svg viewBox="0 0 24 24"><path d="M6 4.75v3M18 4.75v3M4 9.25h16M5 6.25h14v13H5zM8 13h3M8 16h5" /></svg>;
  }
  if (type === "cancel") {
    return <svg viewBox="0 0 24 24"><path d="M12 3.75v16.5M16 7.25H9.75a2.75 2.75 0 0 0 0 5.5h4.5a2.75 2.75 0 0 1 0 5.5H8" /></svg>;
  }
  return <svg viewBox="0 0 24 24"><path d="M12 3.5 14.4 9l5.6.6-4.2 3.8 1.2 5.6-5-2.8L7 19l1.2-5.6L4 9.6 9.6 9 12 3.5Z" /></svg>;
}

function optionTitle(o: CaseOption) {
  return o.optionType === "custom" ? (o.customTitle ?? "Special offer") : OPTION_TITLES[o.optionType];
}

function feasibilityLabel(availability: CaseOption["availability"]) {
  if (availability === "unavailable") return "Not available";
  if (availability === "pending") return "Awaiting hotel confirmation";
  return "Available now";
}

type Step = "compare" | "policy" | "confirm";

// "policy" 不是主流程里的第三步，是从 compare 里点某个方案的"查看政策"临时进去的旁支
// (看完还是回 compare，不会往前走到 confirm)。之前把它当成线性步骤 2/3 画，
// 会出现"直接从比较跳到确认"时政策步骤却显示已完成的假象——这里只画两个真实存在
// 先后关系的步骤，policy detour 时把 compare 视为仍在进行中，不虚报完成度。
const STEPS: { key: Step; label: string }[] = [
  { key: "compare", label: "Compare" },
  { key: "confirm", label: "Confirm" },
];

function StepIndicator({ current }: { current: Step }) {
  const effectiveKey = current === "policy" ? "compare" : current;
  const currentIndex = STEPS.findIndex((s) => s.key === effectiveKey);
  return (
    <div className="flow-steps" aria-hidden="true">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flow-step-group">
          <div className={`flow-step ${i === currentIndex ? "flow-step-active" : ""} ${i < currentIndex ? "flow-step-done" : ""}`}>
            <span className="flow-step-num">{i < currentIndex ? "✓" : i + 1}</span>
            {s.label}
          </div>
          {i < STEPS.length - 1 && <span className="flow-step-connector" />}
        </div>
      ))}
    </div>
  );
}

export function OptionsFlowPage() {
  const { id } = useParams<{ id: string }>();
  const caseId = id!;
  const { user } = useAuth();
  const navigate = useNavigate();

  const [options, setOptions] = useState<CaseOption[]>([]);
  const [caseInfo, setCaseInfo] = useState<CaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>("compare");
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PolicySummary | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ConfirmExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [proposeDatesTarget, setProposeDatesTarget] = useState<CaseOption | null>(null);

  const refresh = useCallback(async () => {
    const [optionsRes, caseRes] = await Promise.all([api.fetchOptions(caseId), api.fetchCase(caseId)]);
    if (optionsRes.code === 0) setOptions(optionsRes.data);
    if (caseRes.code === 0) setCaseInfo(caseRes.data);
    setLoading(false);
  }, [caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activeOption = options.find((o) => o.id === activeOptionId) ?? null;
  const selectedOption = options.find((o) => o.selected) ?? null;

  async function handleSelect(optionId: string) {
    setError(null);
    const res = await api.selectOption(caseId, optionId);
    if (res.code !== 0) {
      setError(res.message);
      return;
    }
    await refresh();
  }

  async function handleProposeDates(optionId: string, newCheckIn: string, newCheckOut: string) {
    setError(null);
    const res = await api.proposeDeferDates(caseId, optionId, newCheckIn, newCheckOut);
    if (res.code !== 0) {
      setError(res.message);
      return;
    }
    if (!res.data.success) {
      setError(res.data.message);
      return;
    }
    setProposeDatesTarget(null);
    await refresh();
  }

  async function openPolicy(optionId: string) {
    setActiveOptionId(optionId);
    setStep("policy");
    const res = await api.fetchPolicy(caseId, optionId);
    if (res.code === 0) setPolicy(res.data);
  }

  async function handleConfirm() {
    if (!selectedOption) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await api.confirmExecution(caseId, selectedOption.id);
      if (res.code !== 0) throw new Error(res.message);
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setConfirming(false);
    }
  }

  if (!user) return null;

  const renderPage = (content: ReactNode) => {
    if (user.role === "hotel") {
      return (
        <HotelDashboardShell active="todo" onNavigate={() => navigate("/hotel/home")} onSearch={() => navigate("/hotel/home")}>
          {content}
        </HotelDashboardShell>
      );
    }
    return user.role === "guest" ? (
      <GuestDashboardShell active="dashboard">{content}</GuestDashboardShell>
    ) : (
      <AppShell centerContent={<RoleTopNav role={user.role} />} showBack>{content}</AppShell>
    );
  };

  const availableCount = options.filter((option) => option.availability !== "unavailable").length;
  const contextHeader = (
    <>
      <button type="button" className="guest-options-back" onClick={() => navigate(`/cases/${caseId}`)}>
        ← Back to Case Conversation (CASE-{caseId.slice(0, 8).toUpperCase()})
      </button>
      {caseInfo && (
        <section className="guest-options-case-strip">
          <div>
            <small>Traveller</small>
            <strong>{caseInfo.guestNickname ?? user.nickname}</strong>
            <span>{caseInfo.confirmationNo ?? "Booking reference not recorded"}</span>
          </div>
          <div>
            <small>Hotel</small>
            <strong>{caseInfo.hotelName ?? "Not recorded"}</strong>
            <span>{caseInfo.checkIn && caseInfo.checkOut ? `${caseInfo.checkIn} → ${caseInfo.checkOut}` : "Stay dates not recorded"}</span>
          </div>
          <div>
            <small>Disruption</small>
            <strong>{caseInfo.disruptionTitle ?? "Not recorded"}</strong>
            <span className="guest-options-priority">{caseInfo.priority} priority</span>
          </div>
          <div>
            <small>Available options</small>
            <strong className="guest-options-count">{availableCount}</strong>
            <span>{options.length} generated</span>
          </div>
        </section>
      )}
    </>
  );

  // 案件已结案：方案环节已经走完，不能再让客人看到可点的 Select/Continue/Confirm——
  // 那是给"还在决策中"阶段用的操作入口，结案后继续暴露会让人以为还能改主意。
  if (!loading && caseInfo?.status === "closed") {
    const finalOption = options.find((o) => o.selected) ?? null;
    return renderPage(
      <div className="options-flow guest-options-workspace">
          {contextHeader}
          <div className="guest-options-heading">
            <div><h1>Recovery Options</h1><p>A record of the solutions reviewed for this disruption.</p></div>
            <StepIndicator current="confirm" />
          </div>

          <div className="resolved-banner">
            <h2>This case is resolved</h2>
            <p>The options stage is closed — no further selection is needed.</p>
            {finalOption && (
              <p className="resolved-banner-pick">
                Final pick: <strong>{optionTitle(finalOption)}</strong>
                {finalOption.perkNames.length > 0 ? ` — includes ${finalOption.perkNames.join(", ")}` : ""}
              </p>
            )}
            {caseInfo && (
              <div className="fee-breakdown resolved-case-recap">
                <div className="fee-row">
                  <span>Disruption</span>
                  <span>{caseInfo.disruptionTitle ?? "—"}</span>
                </div>
                <div className="fee-row">
                  <span>Hotel</span>
                  <span>{caseInfo.hotelName ?? "—"}</span>
                </div>
                {caseInfo.checkIn && caseInfo.checkOut && (
                  <div className="fee-row">
                    <span>Stay dates</span>
                    <span>{caseInfo.checkIn} → {caseInfo.checkOut}</span>
                  </div>
                )}
                <div className="fee-row">
                  <span>Options compared</span>
                  <span>{options.length}</span>
                </div>
              </div>
            )}
          </div>

          {options.length > 0 && (
            <>
              <h3 className="resolved-recap-title">Everything that was compared</h3>
              <div className="option-grid guest-option-grid">
                {options.map((o) => {
                  const payload = parsePayload(o.payloadJson);
                  return (
                    <div
                      key={o.id}
                      className={`option-card guest-option-card option-card-readonly ${o.selected ? "option-card-selected" : "option-card-not-picked"}`}
                    >
                      <header className="guest-option-header">
                        <div className={`guest-option-icon type-${o.optionType}`}><OptionIcon type={o.optionType} /></div>
                        <div><h3>{optionTitle(o)}</h3><p>{o.optionType === "custom" ? "A tailored recovery option for this stay." : OPTION_DESCRIPTIONS[o.optionType]}</p></div>
                        <span className={`guest-option-status ${o.selected ? "selected" : "muted"}`}>{o.selected ? "Final pick" : "Not chosen"}</span>
                      </header>
                      {o.perkNames.length > 0 && <p className="option-line option-perks">Includes: {o.perkNames.join(", ")}</p>}
                      <dl className="guest-option-detail-grid">
                        {o.optionType !== "cancel" && o.optionType !== "custom" && <div><dt>Hotel</dt><dd>{payload.hotel ?? "Same hotel"}</dd></div>}
                        {payload.room_type && <div><dt>Room type</dt><dd>{payload.room_type}</dd></div>}
                        {payload.refund_amount !== undefined && <div><dt>Refund</dt><dd>{payload.refund_amount} {payload.currency}</dd></div>}
                        {payload.fee_diff !== undefined && <div><dt>Fee difference</dt><dd>{payload.fee_diff} {payload.currency}</dd></div>}
                      </dl>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="flow-next-steps">
            <h3>Where to go from here</h3>
            <div className="flow-next-grid">
              <div className="flow-next-card">
                <span className="flow-next-num" aria-hidden="true">✓</span>
                <p>
                  <strong>Booking updated</strong>
                  Your confirmation number and stay details already reflect this outcome.
                </p>
              </div>
              <div className="flow-next-card">
                <span className="flow-next-num" aria-hidden="true">💬</span>
                <p>
                  <strong>Need something else?</strong>
                  Reopen the conversation any time — the AI or a coordinator can pick it back up.
                </p>
              </div>
              <div className="flow-next-card">
                <span className="flow-next-num" aria-hidden="true">🧳</span>
                <p>
                  <strong>Check My Bookings</strong>
                  See the full, up-to-date record for this stay alongside your other bookings.
                </p>
              </div>
            </div>
          </div>
      </div>
    );
  }

  return renderPage(
    <>
      <div className="options-flow guest-options-workspace">
        {contextHeader}
        <div className="guest-options-heading">
          <div><h1>Recovery Options</h1><p>Compare the available solutions and choose what works best for your stay.</p></div>
          <StepIndicator current={step} />
        </div>
        {step === "compare" && (
          <>
            <p className="flow-hint guest-options-hint">Only options confirmed or ready for your review are shown.</p>
            {loading ? (
              <p className="flow-empty">Loading options…</p>
            ) : options.length === 0 ? (
              <p className="flow-empty">No options available yet — check back soon or ask in your conversation.</p>
            ) : (
              <div className="option-grid guest-option-grid">
                {options.map((o) => {
                  const payload = parsePayload(o.payloadJson);
                  const disabled = o.availability === "unavailable";
                  return (
                    <article key={o.id} className={`option-card guest-option-card type-${o.optionType} ${disabled ? "option-card-disabled" : ""} ${o.selected ? "option-card-selected" : ""}`}>
                      <header className="guest-option-header">
                        <div className={`guest-option-icon type-${o.optionType}`}><OptionIcon type={o.optionType} /></div>
                        <div><h3>{optionTitle(o)}</h3><p>{o.optionType === "custom" ? "A tailored recovery option for this stay." : OPTION_DESCRIPTIONS[o.optionType]}</p></div>
                        <span className={`guest-option-status status-${o.availability}`}>{feasibilityLabel(o.availability)}</span>
                      </header>
                      {o.perkNames.length > 0 && (
                        <p className="option-line option-perks">Includes: {o.perkNames.join(", ")}</p>
                      )}
                      {payload.room_image_urls && payload.room_image_urls.length > 0 && (
                        <div className="option-room-photos">
                          {payload.room_image_urls.map((uri, i) => (
                            <img key={i} src={uri} alt={payload.room_type ?? "Room"} className="option-room-photo" />
                          ))}
                        </div>
                      )}
                      {payload.room_description && <p className="option-line option-room-description">{payload.room_description}</p>}
                      <dl className="guest-option-detail-grid">
                        {o.optionType !== "cancel" && o.optionType !== "custom" && <div><dt>Hotel</dt><dd>{payload.hotel ?? "Same hotel"}</dd></div>}
                        {payload.room_type && <div><dt>Room type</dt><dd>{payload.room_type}</dd></div>}
                        {payload.room_amenities && payload.room_amenities.length > 0 && <div><dt>Amenities</dt><dd>{payload.room_amenities.join(", ")}</dd></div>}
                        {payload.distance_km !== undefined && <div><dt>Distance</dt><dd>{payload.distance_km} km</dd></div>}
                        {payload.fee_diff !== undefined && <div><dt>Fee difference</dt><dd className={payload.fee_diff <= 0 ? "positive" : ""}>{payload.fee_diff >= 0 ? "+" : ""}{payload.fee_diff} {payload.currency}</dd></div>}
                        {payload.refund_amount !== undefined && <div><dt>Refund amount</dt><dd>{payload.refund_amount} {payload.currency}</dd></div>}
                        {payload.cancellation_fee !== undefined && <div><dt>Cancellation fee</dt><dd>{payload.cancellation_fee} {payload.currency}</dd></div>}
                        {payload.eta_business_days !== undefined && <div><dt>Processing time</dt><dd>{payload.eta_business_days} business days</dd></div>}
                        {o.optionType === "defer" && payload.new_check_in_offset_days !== undefined && caseInfo?.checkIn && <div><dt>New check-in</dt><dd>{addDaysToDate(caseInfo.checkIn, payload.new_check_in_offset_days)}</dd></div>}
                        {o.optionType === "defer" && payload.new_check_out_offset_days !== undefined && caseInfo?.checkIn && <div><dt>New check-out</dt><dd>{addDaysToDate(caseInfo.checkIn, payload.new_check_out_offset_days)}</dd></div>}
                        {payload.reason && <div><dt>Why we suggest this</dt><dd className="option-recommend-reason">{payload.reason}</dd></div>}
                      </dl>
                      {disabled && <p className="option-reason">This option is no longer available.</p>}

                      <div className="option-actions">
                        <div className="guest-option-secondary-actions">
                          <button type="button" className="option-link-btn" onClick={() => void openPolicy(o.id)}>View policy &amp; fees</button>
                          {o.optionType === "defer" && <button type="button" className="option-link-btn" onClick={() => setProposeDatesTarget(o)}>Propose different dates</button>}
                        </div>
                        <button
                          type="button"
                          className={o.selected ? "option-select-btn option-select-btn-selected" : "option-select-btn"}
                          disabled={disabled}
                          onClick={() => void handleSelect(o.id)}
                        >
                          {o.selected ? "Selected ✓ — change" : "Select this option"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {error && <p className="flow-error">{error}</p>}

            <div className="guest-options-info-grid">
              <section className="guest-selection-card">
                <header><div><small>Your selection</small><h2>{selectedOption ? optionTitle(selectedOption) : "Choose a recovery option"}</h2></div><span>{selectedOption ? "Ready to review" : "No option selected"}</span></header>
                <p>{selectedOption ? "Review your selected option before submitting it for final processing." : "Select one of the available options above to continue."}</p>
                <button type="button" className="flow-continue-btn" disabled={!selectedOption} onClick={() => setStep("confirm")}>Continue to confirm →</button>
              </section>

              <section className="guest-options-help-card">
                <header><h2>Need help deciding?</h2><small>StayRight support</small></header>
                <p>Ask about policy, fees, availability or what happens after you confirm.</p>
                <button type="button" onClick={() => navigate(`/cases/${caseId}`)}>Open case conversation →</button>
              </section>
            </div>

            <div className="flow-next-steps">
              <h3>What happens after you confirm</h3>
              <div className="flow-next-grid">
                <div className="flow-next-card">
                  <span className="flow-next-num" aria-hidden="true">1</span>
                  <p>
                    <strong>Hotel confirms</strong>
                    If the option is still awaiting confirmation, the hotel finalizes availability.
                  </p>
                </div>
                <div className="flow-next-card">
                  <span className="flow-next-num" aria-hidden="true">2</span>
                  <p>
                    <strong>You're notified</strong>
                    A notification lands here and in your email once it's finalized.
                  </p>
                </div>
                <div className="flow-next-card">
                  <span className="flow-next-num" aria-hidden="true">3</span>
                  <p>
                    <strong>Booking updates</strong>
                    Your booking record and confirmation number reflect the change automatically.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {step === "policy" && activeOption && (
          <div className="policy-panel guest-options-focus-panel">
            <button type="button" className="flow-back-btn" onClick={() => setStep("compare")}>
              ← Back to options
            </button>
            <h2>{optionTitle(activeOption)} — policy &amp; fees</h2>
            {policy ? (
              <>
                {policy.excerpt ? (
                  <details className="policy-excerpt" open>
                    <summary>
                      Policy excerpt {policy.docName && `— ${policy.docName}`} {policy.docVersion && `(v${policy.docVersion})`}
                    </summary>
                    <p>{policy.excerpt}</p>
                  </details>
                ) : (
                  <p className="flow-empty">No specific policy excerpt matched — general terms apply.</p>
                )}
                <div className="fee-breakdown">
                  {Object.entries(parsePayload(policy.payloadJson)).filter(([key]) => key !== "hotel_id").map(([key, value]) => (
                    <div key={key} className="fee-row">
                      <span>{key.replace(/_/g, " ")}</span>
                      <span>{value ?? "Pending"}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="flow-empty">Loading policy…</p>
            )}
          </div>
        )}

        {step === "confirm" && selectedOption && (
          <div className="confirm-panel guest-options-focus-panel">
            <button type="button" className="flow-back-btn" onClick={() => setStep("compare")}>
              ← Back to options
            </button>
            <h2>Confirm: {optionTitle(selectedOption)}</h2>

            {!result ? (
              <>
                {(() => {
                  const payload = parsePayload(selectedOption.payloadJson);
                  return (
                    <div className="fee-breakdown confirm-recap">
                      {selectedOption.perkNames.length > 0 && (
                        <div className="fee-row">
                          <span>Includes</span>
                          <span>{selectedOption.perkNames.join(", ")}</span>
                        </div>
                      )}
                      {selectedOption.optionType !== "cancel" && selectedOption.optionType !== "custom" && (
                        <div className="fee-row">
                          <span>Hotel</span>
                          <span>{payload.hotel ?? "Same hotel"}{payload.room_type ? ` · ${payload.room_type}` : ""}</span>
                        </div>
                      )}
                      {payload.fee_diff !== undefined && (
                        <div className="fee-row">
                          <span>Fee difference</span>
                          <span>{payload.fee_diff >= 0 ? "+" : ""}{payload.fee_diff} {payload.currency}</span>
                        </div>
                      )}
                      {payload.refund_amount !== undefined && (
                        <div className="fee-row">
                          <span>Refund</span>
                          <span>{payload.refund_amount} {payload.currency} (fee {payload.cancellation_fee} {payload.currency})</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <p className="confirm-summary">
                  Review the details above, then confirm to submit this choice
                  {selectedOption.optionType !== "cancel" ? " — we'll notify the hotel." : " — a coordinator will confirm your refund."}
                </p>
                {error && <p className="flow-error">{error}</p>}
                <button type="button" className="confirm-submit-btn" disabled={confirming} onClick={() => void handleConfirm()}>
                  {confirming ? <span className="confirm-progress">Submitting…</span> : "Confirm & submit"}
                </button>
              </>
            ) : (
              <div className={`confirm-result confirm-result-${result.outcome}`}>
                <p className="confirm-result-message">{result.message}</p>
                {result.outcome === "success" && (
                  <div className="voucher">
                    <p>
                      <strong>Confirmation:</strong> {result.newConfirmationNo}
                    </p>
                    {result.newCheckIn && result.newCheckOut && (
                      <p>
                        {result.newCheckIn} → {result.newCheckOut}
                      </p>
                    )}
                    <button
                      type="button"
                      className={`voucher-copy-btn ${copied ? "voucher-copy-btn-done" : ""}`}
                      onClick={() => {
                        navigator.clipboard
                          .writeText(result.newConfirmationNo ?? "")
                          .then(() => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1400);
                          })
                          .catch(() => {
                            // 剪贴板权限被拒绝(比如没聚焦)时静默失败，不打断用户。
                          });
                      }}
                    >
                      {copied ? "Copied ✓" : "Copy confirmation number"}
                    </button>
                  </div>
                )}
                {result.outcome === "failed" && (
                  <button type="button" className="confirm-chat-link" onClick={() => navigate(`/cases/${caseId}`)}>
                    Chat with your coordinator →
                  </button>
                )}
                {result.outcome === "processing" && (
                  <button type="button" className="confirm-chat-link" onClick={() => navigate(`/cases/${caseId}`)}>
                    Back to conversation →
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {proposeDatesTarget &&
        caseInfo?.checkIn &&
        (() => {
          const payload = parsePayload(proposeDatesTarget.payloadJson);
          const defaultCheckIn =
            payload.new_check_in_offset_days !== undefined ? addDaysToDate(caseInfo.checkIn, payload.new_check_in_offset_days) : "";
          const defaultCheckOut =
            payload.new_check_out_offset_days !== undefined ? addDaysToDate(caseInfo.checkIn, payload.new_check_out_offset_days) : "";
          return (
            <ProposeDatesModal
              defaultCheckIn={defaultCheckIn}
              defaultCheckOut={defaultCheckOut}
              onCancel={() => setProposeDatesTarget(null)}
              onConfirm={(ci, co) => void handleProposeDates(proposeDatesTarget.id, ci, co)}
            />
          );
        })()}
    </>
  );
}
