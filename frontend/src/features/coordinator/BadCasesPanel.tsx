import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import type { BadCaseLearning, BadCaseListItem, BadCaseThread, BadCaseThreadMessage, KnowledgeDashboard } from "./types";
import "./BadCasesPage.css";

type DetailTab = "conversation" | "knowledge";

function learningLabel(status: string | null | undefined) {
  if (status === "approved") return "In Learned replies";
  if (status === "rejected") return "Rejected";
  if (status === "draft") return "Draft ready";
  return null;
}

function evaluateButtonLabel(learning: BadCaseLearning | null, open: boolean) {
  if (open) return "Close";
  if (learning?.status === "approved") return "View";
  if (learning?.evaluationNote) return "Edit";
  return "Evaluate";
}

export function BadCasesPanel() {
  const [items, setItems] = useState<BadCaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<BadCaseThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [tab, setTab] = useState<DetailTab>("conversation");
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [knowledgeMessageId, setKnowledgeMessageId] = useState<string | null>(null);
  const [evaluationNote, setEvaluationNote] = useState("");
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [learningBusy, setLearningBusy] = useState(false);
  const [learningError, setLearningError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [dashboard, setDashboard] = useState<KnowledgeDashboard | null>(null);
  const latestSelectedIdRef = useRef<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

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

  const knowledgeMessage = thread?.messages.find((m) => m.id === knowledgeMessageId) ?? null;
  const knowledgeLearning = knowledgeMessage?.learning ?? null;

  async function openThread(messageId: string) {
    setSelectedId(messageId);
    latestSelectedIdRef.current = messageId;
    setThreadLoading(true);
    setTab("conversation");
    setLearningError(null);
    setEvaluatingId(null);
    const res = await api.fetchBadCaseThread(messageId);
    if (messageId !== latestSelectedIdRef.current) return;
    if (res.code === 0) {
      setThread(res.data);
      const focus = res.data.messages.find((m) => m.id === res.data.focusMessageId);
      setKnowledgeMessageId(res.data.focusMessageId);
      setEvaluationNote(focus?.learning?.evaluationNote ?? "");
      setDraftMarkdown(focus?.learning?.draftMarkdown ?? "");
    }
    setThreadLoading(false);
  }

  useEffect(() => {
    if (!thread || !chatRef.current) return;
    const focus = chatRef.current.querySelector("[data-focus-reply='true']") as HTMLElement | null;
    focus?.scrollIntoView({ block: "nearest" });
  }, [thread]);

  function patchMessageLearning(messageId: string, next: BadCaseLearning) {
    setThread((prev) => prev ? {
      ...prev,
      messages: prev.messages.map((m) => m.id === messageId ? { ...m, learning: next } : m),
    } : prev);
    setItems((prev) => prev.map((it) => (
      it.messageId === messageId ? { ...it, learningStatus: next.status } : it
    )));
    setEvaluationNote(next.evaluationNote);
    setDraftMarkdown(next.draftMarkdown ?? "");
  }

  function openEvaluate(message: BadCaseThreadMessage) {
    if (evaluatingId === message.id) {
      setEvaluatingId(null);
      return;
    }
    setEvaluatingId(message.id);
    setKnowledgeMessageId(message.id);
    setEvaluationNote(message.learning?.evaluationNote ?? "");
    setDraftMarkdown(message.learning?.draftMarkdown ?? "");
    setLearningError(null);
    setTab("conversation");
  }

  async function generateDraft() {
    if (!evaluatingId) return;
    setLearningBusy(true);
    setLearningError(null);
    const res = await api.evaluateBadCase(evaluatingId, evaluationNote);
    setLearningBusy(false);
    if (res.code !== 0) {
      setLearningError(res.message || "Could not generate a draft");
      return;
    }
    patchMessageLearning(evaluatingId, res.data);
    setKnowledgeMessageId(evaluatingId);
    setEvaluatingId(null);
    setTab("knowledge");
  }

  async function approveLearning() {
    if (!knowledgeMessageId) return;
    setLearningBusy(true);
    setLearningError(null);
    const res = await api.approveBadCaseLearning(knowledgeMessageId, draftMarkdown);
    setLearningBusy(false);
    if (res.code === 0) patchMessageLearning(knowledgeMessageId, res.data);
    else setLearningError(res.message || "Could not approve this draft");
  }

  async function rejectLearning() {
    if (!knowledgeMessageId) return;
    setLearningBusy(true);
    setLearningError(null);
    const res = await api.rejectBadCaseLearning(knowledgeMessageId);
    setLearningBusy(false);
    if (res.code === 0) patchMessageLearning(knowledgeMessageId, res.data);
    else setLearningError(res.message || "Could not reject this draft");
  }

  const knowledgeTabHint = knowledgeLearning?.draftMarkdown
    ? knowledgeLearning.status === "approved" ? "Approved" : "Ready to approve"
    : null;

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
        <h4>How to use this</h4>
        <p>
          Open a disliked conversation, then evaluate a specific AI reply from the button on its right.
          The knowledge draft lands in the Knowledge tab for you to approve into Learned replies.
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
                  onClick={() => void openThread(it.messageId)}
                >
                  <p className="coord-row-conf">{it.guestNickname} · {it.disruptionTitle}</p>
                  <p className="coord-row-sub">{it.aiReplyExcerpt}</p>
                  {it.learningStatus && (
                    <p className={`bad-case-status bad-case-status-${it.learningStatus}`}>
                      {learningLabel(it.learningStatus)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bad-case-detail">
          {!selectedId ? (
            <p className="coord-empty">Select a disliked reply to open the conversation.</p>
          ) : threadLoading || !thread ? (
            <p className="coord-empty">Loading conversation…</p>
          ) : (
            <>
              <div className="bad-case-detail-head">
                <p className="bad-case-detail-title">{thread.guestNickname} · {thread.disruptionTitle}</p>
                <div className="coord-tabs" role="tablist" aria-label="Bad case sections">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "conversation"}
                    className={`coord-tab ${tab === "conversation" ? "coord-tab-active" : ""}`}
                    onClick={() => setTab("conversation")}
                  >
                    Conversation
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === "knowledge"}
                    className={`coord-tab ${tab === "knowledge" ? "coord-tab-active" : ""}`}
                    onClick={() => setTab("knowledge")}
                  >
                    Knowledge{knowledgeTabHint ? ` · ${knowledgeTabHint}` : ""}
                  </button>
                </div>
              </div>

              {tab === "conversation" && (
                <div className="bad-case-chat" ref={chatRef}>
                  {thread.messages.map((message) => {
                    const isGuest = message.senderRole === "guest";
                    const isFocus = message.id === thread.focusMessageId;
                    const evaluating = evaluatingId === message.id;
                    return (
                      <div
                        key={message.id}
                        className={`bad-case-msg ${isGuest ? "bad-case-msg-guest" : ""}`}
                        data-focus-reply={isFocus ? "true" : undefined}
                      >
                        <span className="bad-case-msg-avatar" aria-hidden="true">
                          {isGuest ? "🧳" : message.senderRole === "ai" ? "🤖" : "ℹ️"}
                        </span>
                        <div className="bad-case-msg-main">
                          <div className="bad-case-msg-meta">
                            <span>{isGuest ? "Guest" : message.senderRole === "ai" ? "AI Assistant" : "System"}</span>
                            <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            {message.vote === "dislike" && <span className="bad-case-msg-disliked">Disliked</span>}
                            {message.senderRole === "ai" && (
                              <button
                                type="button"
                                className={`bad-case-eval-btn ${evaluating ? "bad-case-eval-btn-open" : ""} ${message.learning ? "bad-case-eval-btn-done" : ""}`}
                                title="Evaluate this AI reply"
                                onClick={() => openEvaluate(message)}
                              >
                                {evaluateButtonLabel(message.learning, evaluating)}
                              </button>
                            )}
                          </div>
                          <div className={`bad-case-bubble bad-case-bubble-${message.senderRole} ${isFocus ? "bad-case-bubble-focus" : ""}`}>
                            {message.content}
                          </div>
                          {evaluating && (
                            <div className="bad-case-eval-card">
                              <span className="bad-case-step-label">Your evaluation</span>
                              {message.learning?.status === "approved" ? (
                                <p>{message.learning.evaluationNote}</p>
                              ) : (
                                <textarea
                                  className="bad-case-textarea"
                                  rows={4}
                                  value={evaluationNote}
                                  onChange={(e) => setEvaluationNote(e.target.value)}
                                  placeholder="What was wrong, and how should the assistant have answered?"
                                  disabled={learningBusy}
                                />
                              )}
                              {learningError && <p className="bad-case-learn-error">{learningError}</p>}
                              {message.learning?.status !== "approved" && (
                                <button
                                  type="button"
                                  className="bad-case-eval-save"
                                  disabled={learningBusy || !evaluationNote.trim()}
                                  onClick={() => void generateDraft()}
                                >
                                  {learningBusy ? "Summarizing…" : "Save and generate knowledge"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {tab === "knowledge" && (
                <div className="bad-case-knowledge">
                  {!knowledgeLearning?.draftMarkdown ? (
                    <p className="coord-empty">
                      Evaluate an AI reply in Conversation first. The generated knowledge point will appear here for approval.
                    </p>
                  ) : (
                    <>
                      <div className="bad-case-step">
                        <span className="bad-case-step-label">Your evaluation</span>
                        <p>{knowledgeLearning.evaluationNote}</p>
                      </div>
                      <div className="bad-case-step">
                        <span className="bad-case-step-label">Knowledge draft</span>
                        {knowledgeLearning.status === "approved" ? (
                          <pre className="bad-case-draft">{knowledgeLearning.draftMarkdown}</pre>
                        ) : (
                          <textarea
                            className="bad-case-textarea bad-case-textarea-draft"
                            rows={10}
                            value={draftMarkdown}
                            onChange={(e) => setDraftMarkdown(e.target.value)}
                            disabled={learningBusy}
                          />
                        )}
                      </div>
                      {learningError && <p className="bad-case-learn-error">{learningError}</p>}
                      {knowledgeLearning.status === "approved" ? (
                        <p className="bad-case-missed-verdict">
                          Approved into Learned replies{knowledgeLearning.learnedRepliesVersion ? ` v${knowledgeLearning.learnedRepliesVersion}` : ""}.
                        </p>
                      ) : knowledgeLearning.status === "rejected" ? (
                        <p className="bad-case-missed-verdict">Rejected — not added to Knowledge. You can evaluate again in Conversation.</p>
                      ) : (
                        <div className="bad-case-missed-review">
                          <span>Add this section to Learned replies?</span>
                          <div>
                            <button type="button" disabled={learningBusy || !draftMarkdown.trim()} onClick={() => void approveLearning()}>
                              Approve
                            </button>
                            <button type="button" disabled={learningBusy} onClick={() => void rejectLearning()}>
                              Reject
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
