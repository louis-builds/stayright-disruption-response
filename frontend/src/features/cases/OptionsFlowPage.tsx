import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { RoleTopNav } from "../../shared/components/RoleTopNav";
import { useAuth } from "../auth";
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

  // 案件已结案：方案环节已经走完，不能再让客人看到可点的 Select/Continue/Confirm——
  // 那是给"还在决策中"阶段用的操作入口，结案后继续暴露会让人以为还能改主意。
  if (!loading && caseInfo?.status === "closed") {
    const finalOption = options.find((o) => o.selected) ?? null;
    return (
      <AppShell centerContent={<RoleTopNav role={user.role} />} showBack>
        <div className="options-flow">
          <button type="button" className="flow-back-btn" onClick={() => navigate(`/cases/${caseId}`)}>
            ← Back to conversation
          </button>

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
              <div className="option-grid">
                {options.map((o) => {
                  const payload = parsePayload(o.payloadJson);
                  return (
                    <div
                      key={o.id}
                      className={`option-card option-card-readonly ${o.selected ? "option-card-selected" : "option-card-not-picked"}`}
                    >
                      <h3>{optionTitle(o)}</h3>
                      <span className={`tag tag-status ${o.selected ? "tag-status-closed" : "tag-status-muted"}`}>
                        {o.selected ? "Final pick" : "Not chosen"}
                      </span>
                      {o.perkNames.length > 0 && <p className="option-line option-perks">Includes: {o.perkNames.join(", ")}</p>}
                      {o.optionType !== "cancel" && o.optionType !== "custom" && (
                        <p className="option-line">
                          {payload.hotel ?? "Same hotel"}
                          {payload.room_type ? ` · ${payload.room_type}` : ""}
                        </p>
                      )}
                      {payload.refund_amount !== undefined && (
                        <p className="option-line">
                          Refund: {payload.refund_amount} {payload.currency}
                        </p>
                      )}
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
      </AppShell>
    );
  }

  return (
    <AppShell centerContent={<RoleTopNav role={user.role} />} showBack>
      <div className="options-flow">
        <StepIndicator current={step} />
        {step === "compare" && (
          <>
            <p className="flow-hint">Compare your options below. Only options confirmed or ready for review are shown.</p>
            {loading ? (
              <p className="flow-empty">Loading options…</p>
            ) : options.length === 0 ? (
              <p className="flow-empty">No options available yet — check back soon or ask in your conversation.</p>
            ) : (
              <div className="option-grid">
                {options.map((o) => {
                  const payload = parsePayload(o.payloadJson);
                  const disabled = o.availability === "unavailable";
                  return (
                    <div key={o.id} className={`option-card ${disabled ? "option-card-disabled" : ""} ${o.selected ? "option-card-selected" : ""}`}>
                      <h3>{optionTitle(o)}</h3>
                      <span className={`tag tag-status tag-status-${o.availability}`}>{feasibilityLabel(o.availability)}</span>
                      {o.perkNames.length > 0 && (
                        <p className="option-line option-perks">Includes: {o.perkNames.join(", ")}</p>
                      )}

                      {o.optionType !== "cancel" && o.optionType !== "custom" && (
                        <p className="option-line">
                          {payload.hotel ?? "Same hotel"}
                          {payload.room_type ? ` · ${payload.room_type}` : ""}
                        </p>
                      )}
                      {payload.distance_km !== undefined && <p className="option-line">{payload.distance_km} km from original hotel</p>}
                      {payload.reason && <p className="option-line option-recommend-reason">{payload.reason}</p>}
                      {payload.fee_diff !== undefined && (
                        <p className="option-line">
                          Fee difference: {payload.fee_diff >= 0 ? "+" : ""}
                          {payload.fee_diff} {payload.currency}
                        </p>
                      )}
                      {payload.refund_amount !== undefined && (
                        <p className="option-line">
                          Refund: {payload.refund_amount} {payload.currency} (fee {payload.cancellation_fee} {payload.currency})
                        </p>
                      )}
                      {payload.eta_business_days !== undefined && <p className="option-line">ETA: {payload.eta_business_days} business days</p>}
                      {o.optionType === "defer" &&
                        payload.new_check_in_offset_days !== undefined &&
                        payload.new_check_out_offset_days !== undefined &&
                        caseInfo?.checkIn && (
                          <p className="option-line">
                            New dates: {addDaysToDate(caseInfo.checkIn, payload.new_check_in_offset_days)} →{" "}
                            {addDaysToDate(caseInfo.checkIn, payload.new_check_out_offset_days)}
                          </p>
                        )}
                      {disabled && <p className="option-reason">This option is no longer available.</p>}

                      <div className="option-actions">
                        <button type="button" className="option-link-btn" onClick={() => void openPolicy(o.id)}>
                          View policy &amp; fees
                        </button>
                        {o.optionType === "defer" && (
                          <button type="button" className="option-link-btn" onClick={() => setProposeDatesTarget(o)}>
                            Propose different dates
                          </button>
                        )}
                        <button
                          type="button"
                          className={o.selected ? "option-select-btn option-select-btn-selected" : "option-select-btn"}
                          disabled={disabled}
                          onClick={() => void handleSelect(o.id)}
                        >
                          {o.selected ? "Selected ✓ — cancel" : "Select"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {error && <p className="flow-error">{error}</p>}

            <button
              type="button"
              className="flow-continue-btn"
              disabled={!selectedOption}
              onClick={() => setStep("confirm")}
            >
              Continue to confirm
            </button>

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
          <div className="policy-panel">
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
                  {Object.entries(parsePayload(policy.payloadJson)).map(([key, value]) => (
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
          <div className="confirm-panel">
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
    </AppShell>
  );
}
