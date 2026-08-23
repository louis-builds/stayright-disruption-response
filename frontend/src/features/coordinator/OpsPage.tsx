import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "./api";
import type { CaseQueueItem, DisruptionListItem, KpiMetrics, OpsOverview } from "./types";
import "./OpsPage.css";

function KpiBarChart({ kpi }: { kpi: KpiMetrics }) {
  const bars = [
    { label: "First notify rate", pct: kpi.firstNotifyRatePercent },
    { label: "Rebooking retention", pct: kpi.rebookingRetentionPercent },
  ];
  return (
    <div className="ops-kpi-chart">
      {bars.map((b) => (
        <div key={b.label} className="ops-kpi-bar-row">
          <span className="ops-kpi-bar-label">{b.label}</span>
          <div className="ops-kpi-bar-track">
            <div className="ops-kpi-bar-fill" style={{ width: `${Math.min(100, Math.max(0, b.pct))}%` }} />
          </div>
          <span className="ops-kpi-bar-value">{b.pct}%</span>
        </div>
      ))}
    </div>
  );
}

function KpiGrid({ kpi }: { kpi: KpiMetrics }) {
  return (
    <>
      <div className="coord-overview-grid">
        <div className="coord-stat-card">
          <span className="coord-stat-label">15-min first notify rate</span>
          <span className="coord-stat-value">{kpi.firstNotifyRatePercent}%</span>
          <span className="coord-stat-sub">{kpi.firstNotifyNumerator} / {kpi.firstNotifyDenominator} eligible</span>
        </div>
        <div className="coord-stat-card">
          <span className="coord-stat-label">Rebooking retention</span>
          <span className="coord-stat-value">{kpi.rebookingRetentionPercent}%</span>
          <span className="coord-stat-sub">{kpi.rebookingNumerator} / {kpi.rebookingDenominator} closed rebooking-type</span>
        </div>
        <div className="coord-stat-card">
          <span className="coord-stat-label">Avg / median resolution</span>
          <span className="coord-stat-value coord-stat-value-sm">
            {kpi.avgResolutionHours ?? "—"}h / {kpi.medianResolutionHours ?? "—"}h
          </span>
        </div>
        <div className="coord-stat-card">
          <span className="coord-stat-label">Concurrent in-progress</span>
          <span className="coord-stat-value">{kpi.concurrentInProgressCount}</span>
        </div>
        <div className="coord-stat-card">
          <span className="coord-stat-label">Notified / Resolved</span>
          <span className="coord-stat-value coord-stat-value-sm">{kpi.notifiedCount} / {kpi.resolvedCount}</span>
        </div>
        <div className="coord-stat-card coord-stat-card-warn">
          <span className="coord-stat-label">Escalation depth / overdue</span>
          <span className="coord-stat-value coord-stat-value-sm">{kpi.escalationDepth} / {kpi.escalationOverdueCount}</span>
        </div>
      </div>
      <KpiBarChart kpi={kpi} />
    </>
  );
}

export function OpsPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const [day, setDay] = useState("");
  const [disruptionId, setDisruptionId] = useState("");
  const [disruptions, setDisruptions] = useState<DisruptionListItem[]>([]);
  const [globalKpi, setGlobalKpi] = useState<KpiMetrics | null>(null);
  const [drillCases, setDrillCases] = useState<CaseQueueItem[] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await api.fetchOpsOverview();
    if (res.code === 0) setOverview(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    void api.fetchDisruptions().then((res) => {
      if (res.code === 0) setDisruptions(res.data);
    });
  }, [refresh]);

  // 运营看板(信号源/待办积压/告警)也得跟着轮询，不然告警确认后隔壁协调员看到的还是旧状态。
  // 静默刷新，不摸 loading，避免整块内容每 30s 闪一次。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void api.fetchOpsOverview().then((res) => {
        if (res.code === 0) setOverview(res.data);
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadGlobalKpi = useCallback(async () => {
    const res = await api.fetchKpi(day || undefined, disruptionId || undefined);
    if (res.code === 0) setGlobalKpi(res.data);
    if (disruptionId) {
      const casesRes = await api.fetchDisruptionCases(disruptionId);
      if (casesRes.code === 0) setDrillCases(casesRes.data);
    } else {
      setDrillCases(null);
    }
  }, [day, disruptionId]);

  useEffect(() => {
    void loadGlobalKpi();
  }, [loadGlobalKpi]);

  async function ack(key: string) {
    await api.acknowledgeAlert(key);
    await refresh();
  }

  if (loading || !overview) return <p className="coord-empty">Loading…</p>;

  return (
    <div className="ops-page">
      {/* 宽屏下这两块都是固定高度的卡片统计，天然可以并排——单栏堆叠在 1920 宽度下
          白白空着一半横向空间还得多拉一屏滚动条，两栏摆开能省一整屏高度。 */}
      <div className="ops-two-col">
      <section className="escalation-section">
        <h3>Signal sources</h3>
        <div className="ops-signal-grid">
          {overview.signalSources.map((s) => (
            <div key={s.type} className="ops-signal-card">
              <span className="ops-signal-type">{s.type}</span>
              <span className={`tag tag-status-${s.configured ? "normal" : "warn"}`}>
                {s.configured ? "live feed" : "no live feed configured"}
              </span>
              <span className="coord-row-meta">
                last ingested: {s.lastIngestedAt ? new Date(s.lastIngestedAt).toLocaleString() : "never"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="escalation-section">
        <h3>Task backlog & channel health</h3>
        <div className="coord-overview-grid">
          <div className="coord-stat-card coord-stat-card-warn">
            <span className="coord-stat-label">Failed notifications</span>
            <span className="coord-stat-value">{overview.failedNotificationCount}</span>
          </div>
          <div className="coord-stat-card coord-stat-card-warn">
            <span className="coord-stat-label">Overdue hotel inquiries</span>
            <span className="coord-stat-value">{overview.hotelOverdueInquiryCount}</span>
          </div>
          <div className="coord-stat-card coord-stat-card-warn">
            <span className="coord-stat-label">Escalation backlog</span>
            <span className="coord-stat-value">{overview.escalationBacklogDepth}</span>
          </div>
          <div className="coord-stat-card">
            <span className="coord-stat-label">Email / in-app success rate</span>
            <span className="coord-stat-value coord-stat-value-sm">{overview.emailSuccessRatePercent}% / {overview.inAppSuccessRatePercent}%</span>
          </div>
          <div className="coord-stat-card">
            <span className="coord-stat-label">Database</span>
            <span className={`tag tag-status-${overview.databaseHealthy ? "normal" : "overdue"}`}>
              {overview.databaseHealthy ? "healthy" : "unreachable"}
            </span>
          </div>
        </div>
      </section>
      </div>

      {overview.alerts.length > 0 && (
        <section className="escalation-section">
          <h3>Alerts</h3>
          <div className="coord-table">
            {overview.alerts.map((a) => (
              <div key={a.key} className="coord-row">
                <div className="coord-row-main">
                  <span className={`tag tag-status-${a.level === "critical" ? "overdue" : a.level === "warning" ? "warn" : "normal"}`}>
                    {a.level}
                  </span>
                  <p className="coord-row-sub">{a.message}</p>
                </div>
                <div className="coord-row-actions">
                  {a.acknowledged ? (
                    <span className="coord-row-meta">acknowledged today</span>
                  ) : (
                    <button type="button" className="coord-btn-link" onClick={() => void ack(a.key)}>
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="escalation-section">
        <h3>Today's KPI summary</h3>
        <KpiGrid kpi={overview.todayKpi} />
      </section>

      <section className="escalation-section">
        <h3>Global KPI</h3>
        <div className="coord-toolbar">
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <select value={disruptionId} onChange={(e) => setDisruptionId(e.target.value)}>
            <option value="">All disruptions</option>
            {disruptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </div>
        {globalKpi && <KpiGrid kpi={globalKpi} />}
        {drillCases && (
          <div className="ops-drilldown">
            <h4>Cases for this disruption</h4>
            {drillCases.length === 0 ? (
              <p className="coord-empty">No cases.</p>
            ) : (
              <div className="coord-table">
                {drillCases.map((c) => (
                  <div key={c.caseId} className="coord-row">
                    <div className="coord-row-main">
                      <span className="coord-row-conf">{c.confirmationNo}</span>
                      <p className="coord-row-sub">{c.guestNickname} · {c.status}</p>
                    </div>
                    <button type="button" className="coord-btn-link" onClick={() => navigate(`/cases/${c.caseId}`)}>
                      Open
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
