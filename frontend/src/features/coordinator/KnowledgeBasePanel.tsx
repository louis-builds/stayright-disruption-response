import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { GoldenTest, GoldenTestRun, KnowledgeDashboard, RagDocument } from "./types";
import "./KnowledgeBasePanel.css";

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
    <div className="escalation-section">
      <h3>Upload a new version</h3>
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
          Golden tests: {result.passCount} passed / {result.failCount} failed —{" "}
          {result.setAsDefault ? "set as new default version." : "kept previous default (failures block auto-promotion)."}
        </p>
      )}
    </div>
  );
}

function GoldenTestSection({ tests, latestRun, onRun, running }: {
  tests: GoldenTest[]; latestRun: GoldenTestRun | null; onRun: () => void; running: boolean;
}) {
  return (
    <div className="escalation-section">
      <h3>Golden tests ({tests.length})</h3>
      <button type="button" className="coord-btn-secondary" disabled={running} onClick={onRun}>
        {running ? "Running…" : "Run all golden tests now"}
      </button>
      {latestRun && (
        <div className="coord-table">
          <p className="coord-row-sub">
            Last run: {latestRun.passCount} passed / {latestRun.failCount} failed
            {latestRun.triggerDocumentName && ` (triggered by ${latestRun.triggerDocumentName} v${latestRun.triggerVersion})`}
          </p>
          {latestRun.items.map((item, i) => (
            <div key={i} className="coord-row">
              <div className="coord-row-main">
                <span className={`tag tag-status-${item.passed ? "normal" : "overdue"}`}>{item.passed ? "pass" : "fail"}</span>
                <p className="coord-row-sub">{item.input}</p>
                {!item.passed && (
                  <p className="option-admin-reason">
                    expected: {item.expect} — actual: {item.actual}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function KnowledgeBasePanel() {
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [tests, setTests] = useState<GoldenTest[]>([]);
  const [latestRun, setLatestRun] = useState<GoldenTestRun | null>(null);
  const [dashboard, setDashboard] = useState<KnowledgeDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  // refresh()/silentRefresh()(挂载+30秒轮询+切默认版本/跑考题/上传新文档之后都会调用)互相之间
  // 没有任何先后顺序保证——亲测复现过:协调员点了"Set as default"把默认版本切到 v1,
  // silentRefresh() 很快把卡片更新成 v1 default(正确),但紧接着一个更早发出、这时才姗姗来迟落地
  // 的轮询响应(里面还是切换前的旧数据)会把默认版本标签悄悄换回 v2。发起这几处请求前都领一个新
  // 序号，落地时只有序号还是当前最新的那个才允许真的写 state。
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

  // 别的协调员传新版本文档/跑 golden tests 不会自己冒出来——静默轮询，不摸 loading 也不打断正在填的上传表单
  // (轮询只重拉文档/测试/看板这几个只读状态，不动 UploadForm 自己的本地 state)。
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

  // 跑测试/切默认版本都不该像首次加载那样把整页换成一行"Loading…"——
  // 那样会把 UploadForm 卸载重挂，正在草拟的新版本内容(textarea 里的 content state)会被直接冲掉。
  // 真实踩过的坑：填了内容点"Run golden tests"先验证一下，一测完草稿就没了。
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

  const documentNames = [...new Set(documents.map((d) => d.name))];
  const groupedByName = documentNames.map((name) => ({ name, versions: documents.filter((d) => d.name === name) }));

  return (
    <div className="ops-page kb-panel">
      {syncedAt && (
        <p className="kb-sync-indicator">
          <span className="coord-sync-dot" aria-hidden="true" />
          Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s
        </p>
      )}
      <section className="escalation-section">
        <h3>Documents</h3>
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
      </section>

      <UploadForm documentNames={documentNames} onUploaded={() => void silentRefresh()} />

      <GoldenTestSection tests={tests} latestRun={latestRun} onRun={() => void runTests()} running={running} />

      {dashboard && (
        <section className="escalation-section">
          <h3>Quality dashboard</h3>
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
                <div className="kb-quality-bar-fill kb-quality-bar-fill-like" style={{ width: `${dashboard.likeRatePercent}%` }} />
              </div>
              <span className="kb-quality-bar-value">{dashboard.likeRatePercent}%</span>
            </div>
            <div className="kb-quality-bar-row">
              <span className="kb-quality-bar-label">Dislike rate</span>
              <div className="kb-quality-bar-track">
                <div className="kb-quality-bar-fill kb-quality-bar-fill-dislike" style={{ width: `${dashboard.dislikeRatePercent}%` }} />
              </div>
              <span className="kb-quality-bar-value">{dashboard.dislikeRatePercent}%</span>
            </div>
            <div className="kb-quality-bar-row">
              <span className="kb-quality-bar-label">Escalation rate</span>
              <div className="kb-quality-bar-track">
                <div className="kb-quality-bar-fill kb-quality-bar-fill-escalation" style={{ width: `${dashboard.escalationRatePercent}%` }} />
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
        </section>
      )}
    </div>
  );
}
