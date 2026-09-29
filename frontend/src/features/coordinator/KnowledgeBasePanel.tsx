import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import type { GoldenTest, GoldenTestRun, GoldenTestRunItem, KnowledgeDashboard, RagDocument } from "./types";
import "./KnowledgeBasePanel.css";

type KbTab = "docs" | "upload" | "tests" | "quality";
type ResultFilter = "fail" | "all" | "pass";

function UploadForm({ documentNames, onUploaded }: { documentNames: string[]; onUploaded: () => void }) {
  const [name, setName] = useState(documentNames[0] ?? "");
  const [customName, setCustomName] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState("md");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ setAsDefault: boolean; passCount: number; failCount: number } | null>(null);

  async function submit() {
    const finalName = name === "__new__" ? customName.trim() : name;
    if (!finalName || !content.trim()) return;
    setUploading(true);
    setResult(null);
    const res = await api.uploadKbDocument(finalName, content.trim(), sourceType);
    setUploading(false);
    if (res.code === 0) {
      setResult({ setAsDefault: res.data.setAsDefault, passCount: res.data.testRun.passCount, failCount: res.data.testRun.failCount });
      setContent("");
      onUploaded();
    }
  }

  return (
    <div className="kb-tab-body">
      <label className="coord-field">
        <span>Document</span>
        <select value={name} onChange={(e) => setName(e.target.value)}>
          {documentNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value="__new__">+ New document…</option>
        </select>
      </label>
      {name === "__new__" && (
        <label className="coord-field">
          <span>New document name</span>
          <input value={customName} onChange={(e) => setCustomName(e.target.value)} />
        </label>
      )}
      <label className="coord-field">
        <span>Source type</span>
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
          <option value="md">md</option>
          <option value="pdf">pdf</option>
          <option value="txt">txt</option>
        </select>
      </label>
      <label className="coord-field">
        <span>Content (use "## " headings — each becomes a searchable chunk)</span>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={8} />
      </label>
      <button type="button" className="coord-btn-primary" disabled={uploading || !content.trim()} onClick={() => void submit()}>
        {uploading ? "Uploading, chunking, embedding, running golden tests…" : "Upload new version"}
      </button>
      {result && (
        <p className={result.failCount === 0 ? "escalation-refund-confirmed" : "flow-error"}>
          Chat safety tests: {result.passCount} passed / {result.failCount} failed —{" "}
          {result.setAsDefault ? "set as new default version." : "kept previous default (failures block auto-promotion)."}
        </p>
      )}
    </div>
  );
}

function headingFromNote(note: string): string | undefined {
  const part = note.split("|").map((s) => s.trim()).find((s) => s.toLowerCase().startsWith("heading:"));
  return part?.slice("heading:".length).trim();
}

function parseActualRetrieval(actual: string): { doc?: string; heading?: string; score?: number } {
  const match = actual.match(/^(.*?)\s+score=([0-9.]+)\s+\[(.*)\]\s*$/);
  if (!match) return {};
  return { doc: match[1].trim(), score: Number(match[2]), heading: match[3].trim() };
}

function enrichItem(item: GoldenTestRunItem, tests: GoldenTest[]): GoldenTestRunItem {
  const test = tests.find((t) => t.input === item.input);
  const expect = item.expect || test?.expect || "";
  const retrieval = (item.kind ?? (expect.startsWith("retrieval") ? "retrieval" : "chat")) === "retrieval";
  const miss = expect === "retrieval_miss";
  const parsed = parseActualRetrieval(item.actual);
  const expectedHeading = item.expectedChunkHeading
    ?? (test ? headingFromNote(test.note) : undefined)
    ?? null;
  return {
    ...item,
    kind: item.kind ?? (retrieval ? "retrieval" : "chat"),
    expectedSummary: item.expectedSummary || (miss
      ? "Nothing — there is no platform default refund/cancellation policy for this question."
      : retrieval
        ? `Retrieve: ${expectedHeading ?? "the matching knowledge section"}`
        : expect === "refuse_template"
          ? "Refuse with the fixed out-of-scope or privacy template."
          : "A real answer about this guest's own booking."),
    actualSummary: item.actualSummary || item.actual,
    expectedChunkHeading: expectedHeading,
    retrievedDocName: item.retrievedDocName ?? parsed.doc ?? null,
    retrievedHeading: item.retrievedHeading ?? parsed.heading ?? null,
    retrievedScore: item.retrievedScore ?? parsed.score ?? null,
  };
}

function CompareBlock({
  title,
  heading,
  excerpt,
  empty,
}: {
  title: string;
  heading?: string | null;
  excerpt?: string | null;
  empty: string;
}) {
  return (
    <div className="kb-compare-col">
      <h5>{title}</h5>
      {heading || excerpt ? (
        <>
          {heading && <p className="kb-compare-heading">{heading}</p>}
          {excerpt && <pre className="kb-compare-excerpt">{excerpt}</pre>}
        </>
      ) : (
        <p className="kb-compare-empty">{empty}</p>
      )}
    </div>
  );
}

function GoldenResultCard({ item, defaultOpen }: { item: GoldenTestRunItem; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const retrieval = item.kind === "retrieval";
  const retrievedLabel = [item.retrievedDocName, item.retrievedHeading].filter(Boolean).join(" · ");
  const scoreLabel = item.retrievedScore != null ? ` · score ${item.retrievedScore.toFixed(3)}` : "";

  return (
    <article className={`kb-result ${item.passed ? "kb-result-pass" : "kb-result-fail"}`}>
      <button type="button" className="kb-result-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`tag tag-status-${item.passed ? "normal" : "overdue"}`}>{item.passed ? "pass" : "fail"}</span>
        <span className="kb-result-kind">{retrieval ? "Retrieval" : "Chat"}</span>
        <p>{item.input}</p>
      </button>
      {open && (
        <div className="kb-result-body">
          {item.reason && <p className="kb-result-reason">{item.reason}</p>}

          <div className="kb-compare">
            <CompareBlock
              title="Should retrieve"
              heading={retrieval
                ? (item.expect === "retrieval_miss" ? "Nothing (no platform default policy)" : item.expectedChunkHeading)
                : "Not scored — chat safety test"}
              excerpt={item.expectedChunkExcerpt}
              empty={retrieval ? "No matching platform section." : "This test checks the reply, not which chunk is retrieved."}
            />
            <CompareBlock
              title="Did retrieve"
              heading={retrievedLabel ? `${retrievedLabel}${scoreLabel}` : null}
              excerpt={item.retrievedExcerpt}
              empty="Nothing retrieved."
            />
          </div>

          <div className="kb-compare">
            <div className="kb-compare-col">
              <h5>Should answer</h5>
              <pre className="kb-compare-excerpt">
                {retrieval
                  ? "Retrieval-only test — no chat reply is generated. Hotel policy, if any, is not a platform default."
                  : (item.expectedSummary || "—")}
              </pre>
            </div>
            <div className="kb-compare-col">
              <h5>Agent answered</h5>
              <pre className="kb-compare-excerpt">
                {retrieval
                  ? "Not generated. Run a chat-safety test to see the model reply."
                  : (item.actualSummary || item.actual || "—")}
              </pre>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function GoldenTestSection({ tests, latestRun, onRun, running }: {
  tests: GoldenTest[]; latestRun: GoldenTestRun | null; onRun: () => void; running: boolean;
}) {
  const [filter, setFilter] = useState<ResultFilter>("fail");
  const items = useMemo(
    () => (latestRun?.items ?? []).map((item) => enrichItem(item, tests)),
    [latestRun, tests],
  );
  const visible = items.filter((item) => filter === "all" || (filter === "fail" ? !item.passed : item.passed));
  const retrievalCount = tests.filter((t) => t.expect.startsWith("retrieval")).length;

  return (
    <div className="kb-tab-body">
      <p className="coord-row-sub">
        {retrievalCount} retrieval (RAGAS) · {tests.length - retrievalCount} chat safety.
        Each card shows the question, which knowledge should be retrieved, which was retrieved, what the agent should say, and what it said.
      </p>
      <button type="button" className="coord-btn-secondary" disabled={running} onClick={onRun}>
        {running ? "Running…" : "Run all golden tests now"}
      </button>
      {latestRun && (
        <>
          <p className="coord-row-sub">
            Last run: {latestRun.passCount} passed / {latestRun.failCount} failed
            {latestRun.triggerDocumentName && ` (triggered by ${latestRun.triggerDocumentName} v${latestRun.triggerVersion})`}
          </p>
          <div className="kb-result-filters" role="tablist" aria-label="Result filter">
            {(["fail", "all", "pass"] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={filter === key ? "kb-filter-active" : ""}
                onClick={() => setFilter(key)}
              >
                {key === "fail" ? `Failed (${latestRun.failCount})` : key === "pass" ? `Passed (${latestRun.passCount})` : `All (${items.length})`}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="coord-empty">No tests in this filter.</p>
          ) : (
            visible.map((item, i) => (
              <GoldenResultCard key={`${item.input}-${i}`} item={item} defaultOpen={i === 0} />
            ))
          )}
        </>
      )}
    </div>
  );
}

function QualityDashboard({ dashboard }: { dashboard: KnowledgeDashboard }) {
  return (
    <div className="kb-tab-body">
      <div className="coord-overview-grid">
        <div className="coord-stat-card">
          <span className="coord-stat-label">Like rate</span>
          <span className="coord-stat-value">{dashboard.likeRatePercent}%</span>
          <span className="coord-stat-sub">{dashboard.likedCount} / {dashboard.totalAiReplies} AI replies</span>
        </div>
        <div className="coord-stat-card coord-stat-card-warn">
          <span className="coord-stat-label">Dislike rate</span>
          <span className="coord-stat-value">{dashboard.dislikeRatePercent}%</span>
          <span className="coord-stat-sub">{dashboard.dislikedCount} / {dashboard.totalAiReplies} AI replies</span>
        </div>
        <div className="coord-stat-card">
          <span className="coord-stat-label">Escalation rate</span>
          <span className="coord-stat-value">{dashboard.escalationRatePercent}%</span>
          <span className="coord-stat-sub">{dashboard.escalatedCount} / {dashboard.totalAiReplies} AI replies</span>
        </div>
      </div>
      <div className="kb-quality-bars">
        <div className="kb-quality-bar-row">
          <span className="kb-quality-bar-label">Like rate</span>
          <div className="kb-quality-bar-track">
            <div className="kb-quality-bar-fill kb-quality-bar-fill-like" style={{ transform: `scaleX(${dashboard.likeRatePercent / 100})` }} />
          </div>
          <span className="kb-quality-bar-value">{dashboard.likeRatePercent}%</span>
        </div>
        <div className="kb-quality-bar-row">
          <span className="kb-quality-bar-label">Dislike rate</span>
          <div className="kb-quality-bar-track">
            <div className="kb-quality-bar-fill kb-quality-bar-fill-dislike" style={{ transform: `scaleX(${dashboard.dislikeRatePercent / 100})` }} />
          </div>
          <span className="kb-quality-bar-value">{dashboard.dislikeRatePercent}%</span>
        </div>
        <div className="kb-quality-bar-row">
          <span className="kb-quality-bar-label">Escalation rate</span>
          <div className="kb-quality-bar-track">
            <div className="kb-quality-bar-fill kb-quality-bar-fill-escalation" style={{ transform: `scaleX(${dashboard.escalationRatePercent / 100})` }} />
          </div>
          <span className="kb-quality-bar-value">{dashboard.escalationRatePercent}%</span>
        </div>
      </div>
      {dashboard.goldenTestPassRateByVersion.length > 0 && (
        <div className="coord-table" style={{ marginTop: "0.8rem" }}>
          {dashboard.goldenTestPassRateByVersion.map((v) => (
            <div key={`${v.documentName}-${v.version}`} className="coord-row">
              <div className="coord-row-main">
                <span className="coord-row-conf">{v.documentName} v{v.version}</span>
                <p className="coord-row-sub">{v.passRatePercent}% pass rate · {v.failCount} failing</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function KnowledgeBasePanel() {
  const [tab, setTab] = useState<KbTab>("tests");
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [tests, setTests] = useState<GoldenTest[]>([]);
  const [latestRun, setLatestRun] = useState<GoldenTestRun | null>(null);
  const [dashboard, setDashboard] = useState<KnowledgeDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const latestRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    const [docsRes, testsRes, runRes, dashRes] = await Promise.all([
      api.fetchKbDocuments(), api.fetchGoldenTests(), api.fetchLatestGoldenTestRun(), api.fetchKnowledgeDashboard(),
    ]);
    if (requestId === latestRequestIdRef.current) {
      if (docsRes.code === 0) setDocuments(docsRes.data);
      if (testsRes.code === 0) setTests(testsRes.data);
      if (runRes.code === 0) setLatestRun(runRes.data);
      if (dashRes.code === 0) setDashboard(dashRes.data);
      setLoading(false);
      setSyncedAt(new Date());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const silentRefresh = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current;
    const [docsRes, testsRes, runRes, dashRes] = await Promise.all([
      api.fetchKbDocuments(), api.fetchGoldenTests(), api.fetchLatestGoldenTestRun(), api.fetchKnowledgeDashboard(),
    ]);
    if (requestId === latestRequestIdRef.current) {
      if (docsRes.code === 0) setDocuments(docsRes.data);
      if (testsRes.code === 0) setTests(testsRes.data);
      if (runRes.code === 0) setLatestRun(runRes.data);
      if (dashRes.code === 0) setDashboard(dashRes.data);
      setSyncedAt(new Date());
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void silentRefresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [silentRefresh]);

  async function runTests() {
    setRunning(true);
    await api.runGoldenTests();
    setRunning(false);
    await silentRefresh();
  }

  async function setDefault(name: string, version: number) {
    await api.setKbDefaultVersion(name, version);
    await silentRefresh();
  }

  if (loading) return <p className="coord-empty">Loading…</p>;

  const platformDocuments = documents.filter(
    (d) => d.sourceType !== "hotel-policy" && !/^hotel-refund-policy:/i.test(d.name),
  );
  const documentNames = [...new Set(platformDocuments.map((d) => d.name))];
  const groupedByName = documentNames.map((name) => ({ name, versions: platformDocuments.filter((d) => d.name === name) }));

  const tabs: Array<{ key: KbTab; label: string }> = [
    { key: "docs", label: "Documents" },
    { key: "upload", label: "Upload" },
    { key: "tests", label: `Golden tests (${tests.length})` },
    { key: "quality", label: "Quality" },
  ];

  return (
    <div className="ops-page kb-panel">
      {syncedAt && (
        <p className="kb-sync-indicator">
          <span className="coord-sync-dot" aria-hidden="true" />
          Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
        </p>
      )}
      <div className="coord-tabs" role="tablist" aria-label="Knowledge sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`coord-tab ${tab === t.key ? "coord-tab-active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "docs" && (
        <div className="kb-tab-body">
          {groupedByName.map((group) => (
            <div key={group.name} className="escalation-snapshot-grid" style={{ marginBottom: "0.8rem" }}>
              {group.versions.map((d) => (
                <div key={d.id} className="escalation-option-snapshot">
                  <div className="option-admin-header">
                    <h4>{d.name} v{d.version}</h4>
                    {d.isDefaultVersion && <span className="tag tag-status-normal">default</span>}
                  </div>
                  <p className="coord-row-meta">{d.chunkCount} chunks · {d.sourceType || "md"}</p>
                  {!d.isDefaultVersion && (
                    <button type="button" className="coord-btn-link" onClick={() => void setDefault(d.name, d.version)}>
                      Set as default
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === "upload" && (
        <UploadForm documentNames={documentNames} onUploaded={() => void silentRefresh()} />
      )}

      {tab === "tests" && (
        <GoldenTestSection tests={tests} latestRun={latestRun} onRun={() => void runTests()} running={running} />
      )}

      {tab === "quality" && (dashboard
        ? <QualityDashboard dashboard={dashboard} />
        : <p className="coord-empty">No quality data yet.</p>)}
    </div>
  );
}
