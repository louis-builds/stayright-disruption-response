import { useEffect, useMemo, useState } from "react";
import * as api from "./api";
import type { CaseQueueItem, CoordinatorOption, DisruptionDetail, DisruptionListItem, OpsOverview, OverviewDto, SevenDayTrendPoint } from "./types";
import { DisruptionLiveMap } from "./DisruptionLiveMap";
import "./CoordinatorDashboard.css";
import "./CoordinatorAnalyticsDashboard.css";

interface Props {
  data: OverviewDto | null;
  opsData: OpsOverview | null;
  syncedAt: Date | null;
  coordinators: CoordinatorOption[];
  onOpenCases: () => void;
  onOpenMyCases: () => void;
  onOpenDisruptions: () => void;
  onOpenAffectedBookings?: (disruptionId: string, disruptionTitle: string) => void;
  onOpenCase: (id: string) => void;
}

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function caseCode(id: string) { return `CASE-${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`; }
function waitLabel(value: string) {
  const [hourPart, minutePart] = value.split(":");
  if (minutePart === undefined) return value;
  const dayParts = hourPart.split(".");
  const hours = Number(dayParts.at(-1)) + (dayParts.length > 1 ? Number(dayParts[0]) * 24 : 0);
  return hours > 0 ? `${hours}h ${Number(minutePart)}m` : `${Number(minutePart)}m`;
}
function needsHuman(item: CaseQueueItem) {
  return item.priority === "high" || Boolean(item.escalationReason) || item.overdue;
}
function displayReason(item: CaseQueueItem) {
  if (item.escalationReason) return item.escalationReason;
  if (item.isHighValueGuest) return "High-value guest requires review";
  return "Coordinator review required";
}
function reasonLabel(value: string) {
  const translations: Record<string, string> = {
    "AI没把握": "AI confidence too low",
    "客人拒绝全部方案": "Guest rejected all options",
    "没有可行方案": "No feasible option",
    "酒店信息缺失": "Missing hotel information",
    "需要人工审批": "Approval required",
  };
  return translations[value] ?? value;
}

const KNOWN_LOCATIONS = [
  { name: "Auckland", lat: -36.8485, lng: 174.7633 },
  { name: "Wellington", lat: -41.2865, lng: 174.7762 },
  { name: "Christchurch", lat: -43.5321, lng: 172.6362 },
  { name: "Queenstown", lat: -45.0312, lng: 168.6626 },
];

function inferredRegion(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return "Unknown region";
  return [...KNOWN_LOCATIONS].sort((a, b) =>
    Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng)
  )[0]?.name ?? "Unknown region";
}

function readableEventTitle(item: DisruptionListItem, region: string) {
  if (item.region.trim() || !/^\w+\/\w+ disruption$/i.test(item.title)) return item.title;
  const kind = (item.eventSubtype ?? item.type).replaceAll("_", " ");
  return `${kind.replace(/^./, (letter) => letter.toUpperCase())} near ${region}`;
}

export function DisruptionOperationsDashboard({ data, syncedAt, onOpenDisruptions, onOpenAffectedBookings, onOpenCase }: Props) {
  const [disruptions, setDisruptions] = useState<DisruptionListItem[]>([]);
  const [affectedBookings, setAffectedBookings] = useState<CaseQueueItem[]>([]);
  const [recent, setRecent] = useState<CaseQueueItem[]>([]);
  const [eventPresentation, setEventPresentation] = useState<Record<string, { title: string; region: string; handovers: number }>>({});
  const [selectedDisruptionId, setSelectedDisruptionId] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<DisruptionDetail | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);

  useEffect(() => {
    void Promise.all([api.fetchDisruptions(), api.fetchClosed(7)]).then(([d, c]) => {
      if (d.code === 0) {
        setDisruptions(d.data);
        const defaultEvent = [...d.data].filter((item) => item.status === "active").sort((a, b) => b.affectedCount - a.affectedCount)[0] ?? d.data[0];
        setSelectedDisruptionId((current) => current ?? defaultEvent?.id ?? null);
        void Promise.all(d.data.map(async (item) => {
          const [detail, cases] = await Promise.all([api.fetchDisruption(item.id), api.fetchDisruptionCases(item.id)]);
          const region = item.region.trim() || (detail.code === 0 ? inferredRegion(detail.data.lat, detail.data.lng) : "Unknown region");
          return [item.id, {
            title: readableEventTitle(item, region),
            region,
            handovers: cases.code === 0 ? cases.data.filter(needsHuman).length : 0,
          }] as const;
        })).then((rows) => setEventPresentation(Object.fromEntries(rows)));
      }
      if (c.code === 0) setRecent(c.data.slice(0, 3));
    });
  }, []);

  useEffect(() => {
    if (!selectedDisruptionId) return;
    setDetailExpanded(false);
    void Promise.all([api.fetchDisruptionCases(selectedDisruptionId), api.fetchDisruption(selectedDisruptionId)]).then(([cases, detail]) => {
      if (cases.code === 0) {
        const rows = cases.data.filter(needsHuman);
        setAffectedBookings(rows);
        setSelectedCaseId(rows[0]?.caseId ?? null);
      }
      setSelectedDetail(detail.code === 0 ? detail.data : null);
    });
  }, [selectedDisruptionId]);

  const active = useMemo(() => disruptions.filter((item) => item.status === "active"), [disruptions]);
  const selectedDisruption = disruptions.find((item) => item.id === selectedDisruptionId) ?? active[0] ?? disruptions[0];
  const selectedBooking = affectedBookings.find((item) => item.caseId === selectedCaseId) ?? affectedBookings[0] ?? null;
  const attentionCount = (event: DisruptionListItem) => eventPresentation[event.id]?.handovers ?? 0;
  const attentionDisruptions = [...active].sort((a, b) => attentionCount(b) - attentionCount(a) || b.affectedCount - a.affectedCount);
  const rawWeather = (() => {
    if (!selectedDetail?.rawSignalJson) return [] as Array<[string, string]>;
    try {
      const signal = JSON.parse(selectedDetail.rawSignalJson) as Record<string, unknown>;
      const labels: Record<string, [string, string]> = {
        wind_gusts_kmh: ["Wind gusts", "km/h"], precipitation_mm: ["Rainfall", "mm"], snowfall_cm: ["Snowfall", "cm"],
      };
      return Object.entries(signal).filter(([key]) => labels[key]).map(([key, value]) => [labels[key][0], `${String(value)} ${labels[key][1]}`] as [string, string]);
    } catch { return [] as Array<[string, string]>; }
  })();

  if (!data) return <div className="entry-loading">Loading coordinator dashboard...</div>;

  return <div className="entry-dashboard">
    <header className="entry-heading"><div><small className="entry-eyebrow">Disruption monitoring</small><h1>Disruption Operations</h1><p>Monitor active disruptions, inspect event details, and review affected bookings.</p></div>{syncedAt && <span><i/>Synced {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</header>

    <div className="entry-top-grid">
      <section className={`entry-map ${detailExpanded ? "details-open" : ""}`}>
        {selectedDisruption && import.meta.env.VITE_DASHBOARD_LIVE_MAP === "true" && <DisruptionLiveMap disruptionId={selectedDisruption.id}/>} 
        <header><div><h2>Selected Disruption Map</h2><p>Location and impact area for the selected event</p></div>{selectedDisruption?.severity && <b>{selectedDisruption.severity} severity</b>}</header>
        {detailExpanded && <article className="entry-map-summary expanded">
          <button className="entry-map-summary-toggle" onClick={() => setDetailExpanded((current) => !current)} aria-expanded={detailExpanded}>
            <span><small>{selectedDisruption ? (eventPresentation[selectedDisruption.id]?.region ?? selectedDisruption.region) || "Unknown region" : "No active region"}</small><h3>{selectedDisruption ? eventPresentation[selectedDisruption.id]?.title ?? selectedDisruption.title : "No active disruption"}</h3></span>
            <i>{detailExpanded ? "×" : "Details"}</i>
          </button>
          <div className="entry-map-summary-brief"><span>{(selectedDisruption?.eventSubtype ?? selectedDisruption?.type ?? "Unknown").replaceAll("_", " ")}</span><span>{selectedDisruption?.severity ?? "Unrated"} severity</span></div>
          {selectedDetail && <div className="entry-map-detail">
            {selectedDetail.rawSignalText && <p>{selectedDetail.rawSignalText}</p>}
            <dl>
              <div><dt>Impact area</dt><dd>{selectedDetail.radiusKm != null ? `${selectedDetail.radiusKm} km radius` : "Not specified"}</dd></div>
              <div><dt>Starts</dt><dd>{new Date(selectedDetail.startAt).toLocaleString("en-NZ")}</dd></div>
              <div><dt>Expected until</dt><dd>{selectedDetail.endAtOrWindow ? new Date(selectedDetail.endAtOrWindow).toLocaleString("en-NZ") : "Open-ended"}</dd></div>
              <div><dt>Source</dt><dd>{selectedDetail.type === "weather" ? "Weather detection feed" : `${selectedDetail.type} event feed`}</dd></div>
            </dl>
            {rawWeather.length > 0 && <section><strong>Weather evidence</strong><div>{rawWeather.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div></section>}
          </div>}
        </article>}
        <footer>{selectedDisruption && <button onClick={() => onOpenAffectedBookings?.(selectedDisruption.id, eventPresentation[selectedDisruption.id]?.title ?? selectedDisruption.title)}>View Affected Bookings</button>}<button onClick={() => setDetailExpanded((current) => !current)}>{detailExpanded ? "Hide Details" : "View Details"}</button></footer>
      </section>

      <section className="entry-queue entry-disruption-list">
        <header><div><h2>Disruptions Requiring Attention</h2><p>Select an event to update the map and affected booking list</p></div><button onClick={onOpenDisruptions}>View all</button></header>
        <div className="entry-disruption-head"><span>Disruption</span><span>Impact</span><span>AI handovers</span><span>Action</span></div>
        <div className="entry-disruption-body">{attentionDisruptions.length === 0 ? <p className="entry-empty">No active disruptions require attention.</p> : attentionDisruptions.slice(0, 6).map((item) => {
          const handovers = attentionCount(item);
          return <button key={item.id} className={item.id === selectedDisruption?.id ? "selected" : ""} onClick={() => setSelectedDisruptionId(item.id)}><span><b>{eventPresentation[item.id]?.title ?? item.title}</b><small>{item.eventSubtype ?? item.type} · {(eventPresentation[item.id]?.region ?? item.region) || "Unknown region"}</small></span><span><b>{item.affectedCount}</b><small>bookings</small></span><span><b>{handovers}</b><small>need review</small></span><em>{item.id === selectedDisruption?.id ? "Viewing" : "View on map"}</em></button>;
        })}</div>
      </section>
    </div>

    <div className="entry-work-grid">
      <section className="entry-my-cases"><header><div><h2>Affected Bookings Requiring Attention</h2><p>{selectedDisruption ? `Human-review bookings linked to ${selectedDisruption.title}` : "Select a disruption above"}</p></div></header><div className="entry-affected-head"><span>Booking & guest</span><span>Impact</span><span>AI handoff reason</span><span>Waiting</span><span>Status</span><span>Action</span></div>{affectedBookings.length === 0 ? <p className="entry-empty">No human-review bookings are linked to this disruption.</p> : affectedBookings.slice(0, 6).map((item) => <button className={`entry-affected-row ${selectedBooking?.caseId === item.caseId ? "selected" : ""}`} key={item.caseId} onClick={() => setSelectedCaseId(item.caseId)}><span className="entry-booking"><i>{initials(item.guestNickname)}</i><b>{item.confirmationNo || caseCode(item.caseId)}</b><small>{item.guestNickname}</small></span><span>{item.disruptionTitle}</span><span>{displayReason(item)}</span><time className={item.overdue ? "overdue" : ""}>{waitLabel(item.waitTime)}</time><em>{item.status.replaceAll("_", " ")}</em><i onClick={(event) => { event.stopPropagation(); onOpenCase(item.caseId); }}>{item.status === "in_progress" ? "Resume" : "Review"}</i></button>)}</section>

      <aside className="entry-handoff entry-handoff-details"><header><div><h2>AI Handoff Details</h2><p>{selectedBooking ? `${selectedBooking.confirmationNo || caseCode(selectedBooking.caseId)} · ${selectedBooking.guestNickname}` : "Select an affected booking"}</p></div></header>{selectedBooking ? <><section><b>Guest's request</b><p className="unavailable">Not available in the dashboard API.</p></section><section><b>What AI tried</b><p className="unavailable">Not available in the dashboard API.</p></section><section><b>Why AI escalated</b><p>{selectedBooking.escalationReason ?? "No AI escalation reason was recorded."}</p></section><section><b>Missing or conflicting information</b><p className="unavailable">Not available in the dashboard API.</p></section><section><b>Suggested first action</b><p>Open the Case Workspace and review the conversation history and confirmed case evidence.</p></section><button onClick={() => onOpenCase(selectedBooking.caseId)}>Open Case Workspace →</button></> : <p className="entry-empty">Select a booking to view its AI handoff.</p>}</aside>
    </div>

    <section className="entry-recent"><header><div><h2>Recent Resolutions</h2><p>Cases closed during the last seven days</p></div></header><div>{recent.length === 0 ? <p className="entry-empty">No recent resolutions.</p> : recent.map((item) => <button key={item.caseId} onClick={() => onOpenCase(item.caseId)}><span><b>{item.confirmationNo || caseCode(item.caseId)}</b><small>{item.guestNickname}</small></span><em>{item.disruptionTitle}</em><strong>Resolved</strong><i>View history →</i></button>)}</div></section>
  </div>;
}

export function CoordinatorDashboard({ data, opsData, syncedAt, onOpenCases, onOpenMyCases, onOpenDisruptions }: Props) {
  const [queue, setQueue] = useState<CaseQueueItem[]>([]);
  const [mine, setMine] = useState<CaseQueueItem[]>([]);
  const [disruptions, setDisruptions] = useState<DisruptionListItem[]>([]);
  const [sevenDayTrend, setSevenDayTrend] = useState<SevenDayTrendPoint[] | null>(null);

  useEffect(() => {
    void Promise.all([api.fetchQueue(), api.fetchMine("pending"), api.fetchMine("in_progress"), api.fetchDisruptions()]).then(([q, p, i, d]) => {
      if (q.code === 0) setQueue(q.data);
      const assigned = [...(i.code === 0 ? i.data : []), ...(p.code === 0 ? p.data : [])];
      setMine(Array.from(new Map(assigned.map((item) => [item.caseId, item])).values()));
      if (d.code === 0) setDisruptions(d.data);
    });
  }, []);

  useEffect(() => {
    void api.fetchSevenDayTrend().then((response) => {
      if (response.code === 0) setSevenDayTrend(response.data);
    });
  }, []);

  if (!data) return <div className="analytics-loading">Loading operations analytics...</div>;

  const attention = queue.filter(needsHuman);
  const statusRows = [
    { label: "Pending", value: data.pendingCount, color: "#7628e8" },
    { label: "In progress", value: data.inProgressCount, color: "#3478f6" },
    { label: "Closed today", value: data.closedTodayCount, color: "#12c7a0" },
  ];
  const statusTotal = Math.max(statusRows.reduce((sum, row) => sum + row.value, 0), 1);
  const statusStops = statusRows.reduce<{ offset: number; stops: string[] }>((acc, row) => {
    const next = acc.offset + (row.value / statusTotal) * 100;
    acc.stops.push(`${row.color} ${acc.offset}% ${next}%`);
    acc.offset = next;
    return acc;
  }, { offset: 0, stops: [] }).stops.join(",");

  const reasonCounts = new Map<string, number>();
  attention.forEach((item) => {
    const label = reasonLabel(item.escalationReason ?? (item.isHighValueGuest ? "High-value guest review" : item.overdue ? "SLA overdue" : "Priority review"));
    reasonCounts.set(label, (reasonCounts.get(label) ?? 0) + 1);
  });
  const reasons = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxReason = Math.max(...reasons.map(([, value]) => value), 1);

  const handoverByTitle = new Map<string, number>();
  attention.forEach((item) => handoverByTitle.set(item.disruptionTitle, (handoverByTitle.get(item.disruptionTitle) ?? 0) + 1));
  const disruptionWork = disruptions.map((item) => ({ ...item, handovers: handoverByTitle.get(item.title) ?? 0 }))
    .filter((item) => item.handovers > 0).sort((a, b) => b.handovers - a.handovers).slice(0, 5);
  const maxHandover = Math.max(...disruptionWork.map((item) => item.handovers), 1);

  const workload = [
    { label: "Pending", value: data.pendingCount, color: "purple" },
    { label: "In progress", value: data.inProgressCount, color: "blue" },
    { label: "Attention", value: attention.length, color: "orange" },
    { label: "Closed today", value: data.closedTodayCount, color: "green" },
  ];
  const maxWorkload = Math.max(...workload.map((item) => item.value), 1);
  const maxTrendTotal = Math.max(...(sevenDayTrend ?? []).map((day) =>
    day.newCases + day.inProgress + day.awaitingGuest + day.awaitingHotel + day.closed), 1);
  const reasonTotal = Math.max(reasons.reduce((sum, [, value]) => sum + value, 0), 1);
  const peakTrend = sevenDayTrend?.reduce<{ label: string; total: number } | null>((peak, day) => {
    const total = day.newCases + day.inProgress + day.awaitingGuest + day.awaitingHotel + day.closed;
    const label = new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long" });
    return !peak || total > peak.total ? { label, total } : peak;
  }, null);

  return <main className="analytics-dashboard">
    <header className="analytics-heading"><div><span>Operations overview</span><h1>Operations Analytics &amp; Intelligence</h1><p>Monitor workload, AI handovers, hotel delays and resolution performance.</p></div><aside><b><i/>Live data</b>{syncedAt && <small>Updated {syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>}</aside></header>

    <section className="analytics-kpis">
      <button className="attention" onClick={onOpenCases}><span>Cases requiring attention</span><strong>{attention.length}</strong><i className="amber">△</i><div><small>AI handovers and urgent cases</small><em>Filter cases&nbsp; →</em></div></button>
      <button className="overdue" onClick={onOpenCases}><span>Overdue cases</span><strong>{data.overdueInProgressCount}</strong><i className="rose">♧</i><div><small>SLA threshold exceeded</small><em>Urgent filter&nbsp; →</em></div></button>
      <button className="hotel" onClick={onOpenCases}><span>Waiting for hotel</span><strong>{opsData?.hotelOverdueInquiryCount ?? "—"}</strong><i className="violet">▦</i><div><small>Responses requiring follow-up</small><em>Hotel filter&nbsp; →</em></div></button>
      <button className="mine" onClick={onOpenMyCases}><span>My active cases</span><strong>{mine.length}</strong><i className="teal">♙</i><div><small>Open cases assigned to you</small><em>Assigned filter&nbsp; →</em></div></button>
    </section>

    <section className="analytics-primary-grid">
      <article className="analytics-card workload-card trend-card"><header><div><h2><i>▥</i>{sevenDayTrend ? "Case Workload Trend" : "Current Case Workload"}</h2><p>{sevenDayTrend ? "7-day stacked distribution by case operational phase" : "Live operational snapshot from current case states"}</p></div>{sevenDayTrend && <div className="trend-legend"><span className="new">New</span><span className="progress">In progress</span><span className="guest">Waiting for guest</span><span className="hotel">Waiting for hotel</span><span className="closed">Closed</span></div>}</header>{sevenDayTrend ? <><div className="seven-day-chart">{sevenDayTrend.map((day) => { const total = day.newCases + day.inProgress + day.awaitingGuest + day.awaitingHotel + day.closed; return <div key={day.date} className="trend-day"><span className="trend-stack" style={{ height: `${Math.max((total / maxTrendTotal) * 82, total ? 7 : 2)}%` }} title={`${day.date}: ${total} recorded activities`}><i className="closed" style={{ flex: day.closed }}/><i className="hotel" style={{ flex: day.awaitingHotel }}/><i className="guest" style={{ flex: day.awaitingGuest }}/><i className="progress" style={{ flex: day.inProgress }}/><i className="new" style={{ flex: day.newCases }}/></span><small>{new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short" })}</small><b>{total}</b></div>; })}</div><footer className="trend-summary"><span><i/>Peak workload was recorded on {peakTrend?.label ?? "—"} with {peakTrend?.total ?? 0} case activities.</span><button onClick={onOpenCases}>View all cases →</button></footer></> : <div className="workload-chart">{workload.map((item) => <div key={item.label}><span className={`bar ${item.color}`} style={{ height: `${Math.max((item.value / maxWorkload) * 82, 5)}%` }}><b>{item.value}</b></span><small>{item.label}</small></div>)}</div>}</article>

      <article className="analytics-card reasons-card"><header><div><h2><i>☷</i>Human Intervention Reasons</h2><p>Top drivers requiring coordinator takeover</p></div></header><div className="reason-bars">{reasons.length === 0 ? <p className="analytics-empty">No recorded intervention reasons.</p> : reasons.map(([label, value], index) => <div key={label}><span><b>{label}</b><em><strong>{value}</strong> ({Math.round((value / reasonTotal) * 100)}%)</em></span><i><u style={{ width: `${(value / maxReason) * 100}%`, background: ["#7628e8", "#f59d0a", "#f43d61", "#11988b", "#6366f1"][index] }}/></i></div>)}</div><footer className="reason-summary">Based on {reasonTotal} current attention cases <button onClick={onOpenCases}>Click to filter</button></footer></article>
    </section>

    <section className="analytics-secondary-grid">
      <article className="analytics-card status-card"><header><div><h2><i>◉</i>Case Status Distribution</h2><p>Current open cases and cases closed today</p></div></header><div className="status-content"><div className="status-donut" style={{ background: `conic-gradient(${statusStops})` }}><span><b>{statusRows.reduce((sum, row) => sum + row.value, 0)}</b><small>cases</small></span></div><ul>{statusRows.map((row) => <li key={row.label}><i style={{ background: row.color }}/><span>{row.label}</span><b>{row.value}</b></li>)}</ul></div></article>

      <article className="analytics-card hotel-card metric-detail-card"><header><div><h2><i>▦</i>Hotel Response Performance</h2><p>Inquiry follow-up and communication delivery health</p></div></header><div className="metric-summary-grid"><div><span>Email delivery</span><strong>{opsData ? `${opsData.emailSuccessRatePercent}%` : "—"}</strong></div><div className="danger"><span>Overdue</span><strong>{opsData?.hotelOverdueInquiryCount ?? "—"}</strong></div><div className="success"><span>In-app delivery</span><strong>{opsData ? `${opsData.inAppSuccessRatePercent}%` : "—"}</strong></div></div><div className="metric-progress-list"><div><span><b>Email notification success</b><em>{opsData ? `${opsData.emailSuccessRatePercent}%` : "—"}</em></span><i><u style={{ width: `${opsData?.emailSuccessRatePercent ?? 0}%` }}/></i></div><div><span><b>In-app notification success</b><em>{opsData ? `${opsData.inAppSuccessRatePercent}%` : "—"}</em></span><i><u style={{ width: `${opsData?.inAppSuccessRatePercent ?? 0}%` }}/></i></div><div className="failed"><span><b>Notifications requiring follow-up</b><em>{opsData?.failedNotificationCount ?? "—"} failed</em></span><i><u style={{ width: `${Math.min((opsData?.failedNotificationCount ?? 0) * 10, 100)}%` }}/></i></div></div></article>

      <article className="analytics-card resolution-card metric-detail-card"><header><div><h2><i>ϟ</i>Resolution Performance</h2><p>Resolution speed, notification coverage and outcomes</p></div></header><div className="resolution-main"><span>Average resolution time</span><strong>{opsData?.todayKpi.avgResolutionHours ?? "—"}<small>{opsData?.todayKpi.avgResolutionHours == null ? "" : " h"}</small></strong><em>Median {opsData?.todayKpi.medianResolutionHours ?? "—"} h</em></div><div className="resolution-compliance"><span><b>First notification coverage</b><em>{opsData ? `${opsData.todayKpi.firstNotifyRatePercent}%` : "—"}</em></span><i><u style={{ width: `${opsData?.todayKpi.firstNotifyRatePercent ?? 0}%` }}/></i></div><div className="resolution-outcomes"><div><span>Rebooking retention</span><b>{opsData ? `${opsData.todayKpi.rebookingRetentionPercent}%` : "—"}</b><small>{opsData?.todayKpi.rebookingNumerator ?? 0} retained bookings</small></div><div><span>Resolved cases</span><b>{opsData?.todayKpi.resolvedCount ?? "—"}</b><small>Recorded in today’s KPI window</small></div></div></article>
    </section>

    <section className="analytics-card disruption-ranking"><header><div><h2>Disruptions Creating Human Work</h2><p>Ranked by current AI handover cases, not total affected bookings</p></div><button onClick={onOpenDisruptions}>View disruptions →</button></header><div>{disruptionWork.length === 0 ? <p className="analytics-empty">No disruption-linked human handovers.</p> : disruptionWork.map((item) => <button key={item.id} onClick={onOpenDisruptions}><span><b>{item.title}</b><small>{item.type} · {item.region}</small></span><i><u style={{ width: `${(item.handovers / maxHandover) * 100}%` }}/></i><em>{item.handovers} handovers</em><strong>{item.affectedCount} affected</strong></button>)}</div></section>
  </main>;
}
