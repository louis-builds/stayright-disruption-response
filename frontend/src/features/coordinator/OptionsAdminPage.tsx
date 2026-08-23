import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { CoordinatorTopNav } from "../../shared/components/CoordinatorTopNav";
import { useAuth } from "../auth";
import * as caseApi from "../cases/api";
import type { CaseSummary } from "../cases/types";
import * as api from "./api";
import type { AdminOption } from "./types";
import "./OptionsAdminPage.css";

const OPTION_TITLES: Record<string, string> = {
  defer: "Defer & keep original hotel",
  alternate: "Move to an alternative stay",
  cancel: "Cancel & refund",
};

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
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

function OptionCard({ option, caseId, readOnly, onChanged }: { option: AdminOption; caseId: string; readOnly: boolean; onChanged: () => void }) {
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

  return (
    <div className={`option-admin-card ${option.availability === "unavailable" ? "option-admin-card-unavailable" : ""}`}>
      <div className="option-admin-header">
        <h3>{option.optionType === "custom" ? (option.customTitle ?? "Custom option") : (OPTION_TITLES[option.optionType] ?? option.optionType)}</h3>
        <div className="option-admin-tags">
          <span className={`tag tag-status-${option.availability === "unavailable" ? "overdue" : "normal"}`}>{option.availability}</span>
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
          {Object.entries(fields).map(([key, value]) => (
            <label key={key} className="coord-field">
              <span>{key.replace(/_/g, " ")}</span>
              <input
                value={value}
                disabled={option.locked || readOnly}
                onChange={(e) => setFields((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}

      <div className="option-admin-actions">
        {readOnly ? (
          <span className="coord-row-meta">Case closed — read-only</span>
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
    const [caseRes, optionsRes] = await Promise.all([caseApi.fetchCase(caseId), api.fetchAdminOptions(caseId)]);
    if (requestId === latestRequestIdRef.current) {
      if (caseRes.code === 0) setCaseSummary(caseRes.data);
      if (optionsRes.code === 0) setOptions(optionsRes.data);
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
      void Promise.all([caseApi.fetchCase(caseId), api.fetchAdminOptions(caseId)]).then(([caseRes, optionsRes]) => {
        if (requestId === latestRequestIdRef.current) {
          if (caseRes.code === 0) setCaseSummary(caseRes.data);
          if (optionsRes.code === 0) setOptions(optionsRes.data);
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
    }
  }

  const allUnavailable = options.length > 0 && options.every((o) => o.availability === "unavailable");
  const isClosed = caseSummary?.status === "closed";

  if (!user) return null;

  return (
    <AppShell
      centerContent={<CoordinatorTopNav activeTab="todo" />}
      showBack={() => navigate("/coordinator/home", { state: { tab: "todo" } })}
    >
      <div className="options-admin-layout">
      <div className="options-admin">
        {caseSummary && (
          <p className="options-admin-summary">
            {caseSummary.hotelName} · {caseSummary.checkIn} → {caseSummary.checkOut} · {caseSummary.disruptionTitle}
          </p>
        )}

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

        <div className="coord-toolbar">
          <button type="button" className="coord-btn-secondary" disabled={regenerating || isClosed} onClick={() => void regenerate()}>
            {regenerating ? "Regenerating…" : "Regenerate unlocked options"}
          </button>
          <button type="button" className="coord-btn-primary" disabled={pushing || options.length === 0 || isClosed} onClick={() => void push()}>
            {pushing ? "Pushing…" : "Push options to guest"}
          </button>
        </div>
        {pushResult && <p className="options-admin-push-result">{pushResult}</p>}

        {loading ? (
          <p className="coord-empty">Loading…</p>
        ) : options.length === 0 ? (
          <p className="coord-empty">No options for this case.</p>
        ) : (
          <div className="option-admin-grid">
            {options.map((o) => (
              <OptionCard key={o.id} option={o} caseId={caseId} readOnly={isClosed} onChanged={() => void refresh()} />
            ))}
          </div>
        )}
      </div>

      {caseSummary && (
        <aside className="options-admin-side">
          <div className="options-admin-side-card">
            <h3>Case details</h3>
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
                  {options.filter((o) => o.availability !== "unavailable").length} available / {options.length} total
                </dd>
              </div>
            </dl>
            <button type="button" className="options-admin-chat-btn" onClick={() => navigate(`/cases/${caseId}`)}>
              Open case conversation →
            </button>
          </div>
          {syncedAt && (
            <p className="coord-sync-indicator options-admin-sync">
              <span className="coord-sync-dot" aria-hidden="true" />
              Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
            </p>
          )}
        </aside>
      )}
      </div>
    </AppShell>
  );
}
