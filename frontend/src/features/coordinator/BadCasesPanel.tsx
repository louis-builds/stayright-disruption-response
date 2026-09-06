import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "./api";
import type { BadCaseListItem, BadCaseReplay, KnowledgeDashboard } from "./types";
import "./BadCasesPage.css";

export function BadCasesPanel() {
  const navigate = useNavigate();
  const [items, setItems] = useState<BadCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replay, setReplay] = useState<BadCaseReplay | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [dashboard, setDashboard] = useState<KnowledgeDashboard | null>(null);
  // 回放面板的分析是真的实时调 Gemini 生成的,耗时不固定(几秒到十几秒都有可能)——协调员点开A条
  // 之后反悔改点B条是很正常的操作,如果A条的分析比B条晚返回，原来会无条件 setReplay 把面板悄悄换
  // 回A条内容，可高亮的行还是B条，用户完全发现不了。用这个 ref 记录"最新一次点开的是哪条"，响应
  // 落地时只有还对得上号才允许真的写 state。
  const latestSelectedIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [casesRes, dashRes] = await Promise.all([api.fetchBadCases(), api.fetchKnowledgeDashboard()]);
    if (casesRes.code === 0) setItems(casesRes.data);
    if (dashRes.code === 0) setDashboard(dashRes.data);
    setLoading(false);
    setSyncedAt(new Date());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 别的协调员那边又有新的差评/AI 又答错不会自己冒出来——静默轮询，不摸 loading。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void Promise.all([api.fetchBadCases(), api.fetchKnowledgeDashboard()]).then(([casesRes, dashRes]) => {
        if (casesRes.code === 0) setItems(casesRes.data);
        if (dashRes.code === 0) setDashboard(dashRes.data);
        setSyncedAt(new Date());
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => [it.guestNickname, it.disruptionTitle, it.aiReplyExcerpt].some((f) => f?.toLowerCase().includes(q)));
  }, [items, query]);

  async function openReplay(messageId: string) {
    setSelectedId(messageId);
    latestSelectedIdRef.current = messageId;
    setReplayLoading(true);
    const res = await api.fetchBadCaseReplay(messageId);
    if (messageId === latestSelectedIdRef.current) {
      if (res.code === 0) setReplay(res.data);
      setReplayLoading(false);
    }
  }

  async function confirmMissed(messageId: string, confirmed: boolean) {
    await api.confirmMissedEscalation(messageId, confirmed);
    setItems((prev) => prev.map((it) => (it.messageId === messageId ? { ...it, missedEscalationConfirmed: confirmed } : it)));
  }

  return (
    <div className="bad-cases-page">
      <div className="coord-queue-stats">
        <div className="coord-stat-card">
          <span className="coord-stat-label">Disliked replies</span>
          <span className="coord-stat-value">{items.length}</span>
        </div>
        {dashboard && (
          <>
            <div className="coord-stat-card coord-stat-card-warn">
              <span className="coord-stat-label">Dislike rate (all-time)</span>
              <span className="coord-stat-value">{dashboard.dislikeRatePercent}%</span>
            </div>
            <div className="coord-stat-card">
              <span className="coord-stat-label">Total AI replies</span>
              <span className="coord-stat-value">{dashboard.totalAiReplies}</span>
            </div>
          </>
        )}
      </div>

      <div className="bad-cases-tip">
        <h4>Where these come from</h4>
        <p>
          When a guest thumbs-down an AI reply in their case conversation, it lands here with the guest's original
          question, the reply that got the dislike, and an LLM-generated analysis of what likely went wrong — so a
          coordinator can spot knowledge-base gaps without re-reading the whole thread.
        </p>
      </div>

      {items.length > 4 && (
        <input
          className="coord-search-input bad-cases-search"
          placeholder="Search by guest, disruption, or reply text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {syncedAt && (
        <p className="coord-sync-indicator bad-cases-sync">
          <span className="coord-sync-dot" aria-hidden="true" />
          Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
        </p>
      )}

      <div className="bad-cases">
      <div className="bad-cases-list">
        {loading ? (
          <p className="coord-empty">
            <span className="coord-search-spinner coord-loading-spinner-dark" aria-hidden="true" /> Loading…
          </p>
        ) : filtered.length === 0 ? (
          <p className="coord-empty">{query ? "No matches." : "No disliked AI replies yet."}</p>
        ) : (
          <div className="coord-table">
            {filtered.map((it) => (
              <button
                key={it.messageId}
                type="button"
                className={`coord-disruption-row ${it.messageId === selectedId ? "coord-disruption-row-active" : ""}`}
                onClick={() => void openReplay(it.messageId)}
              >
                <p className="coord-row-conf">{it.guestNickname} · {it.disruptionTitle}</p>
                <p className="coord-row-sub">{it.aiReplyExcerpt}</p>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="bad-case-replay">
        {!selectedId ? (
          <p className="coord-empty">Select a disliked reply to replay it.</p>
        ) : replayLoading ? (
          <p className="coord-empty">Loading replay…</p>
        ) : (
          replay && (
            <div className="bad-case-replay-content">
              <div className="bad-case-step">
                <span className="bad-case-step-label">Guest's question (input)</span>
                <p>{replay.precedingGuestQuestion ?? "(not available — reply may have been proactive)"}</p>
              </div>
              <div className="bad-case-step">
                <span className="bad-case-step-label">AI's disliked reply (output)</span>
                <p>{replay.aiReply}</p>
              </div>
              <div className="bad-case-step bad-case-analysis">
                <span className="bad-case-step-label">LLM analysis</span>
                <p>{replay.analysis}</p>
              </div>
              {(() => {
                const selected = items.find((it) => it.messageId === selectedId);
                if (!selected || selected.escalated) return null;
                if (selected.missedEscalationConfirmed !== null) {
                  return (
                    <p className="bad-case-missed-verdict">
                      {selected.missedEscalationConfirmed ? "Confirmed: this should have escalated." : "Confirmed: escalation was not needed."}
                    </p>
                  );
                }
                return (
                  <div className="bad-case-missed-review">
                    <span>Should this have escalated to a coordinator?</span>
                    <div>
                      <button type="button" onClick={() => void confirmMissed(selected.messageId, true)}>Yes, missed it</button>
                      <button type="button" onClick={() => void confirmMissed(selected.messageId, false)}>No, fine as-is</button>
                    </div>
                  </div>
                );
              })()}
              <button type="button" className="coord-btn-link" onClick={() => navigate(`/cases/${replay.caseId}`)}>
                Open this case's conversation →
              </button>
            </div>
          )
        )}
      </div>
      </div>
    </div>
  );
}
