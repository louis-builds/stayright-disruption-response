import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as notificationsApi from "../notifications/api";
import type { NotificationItem } from "../notifications/types";
import { useMyCases } from "../cases/useMyCases";
import * as bookingsApi from "../bookings/api";
import type { BookingSummary } from "../bookings/types";
import { useAuth } from "../auth";
import { GuestDashboardShell } from "./GuestDashboardShell";
import "./GuestHomePage.css";

const NOTICE_POLL_MS = 20_000;
// ponytail: 一次多拉 40 条再前端搜索/分页，客人自己的通知列表量级不会大到需要真·服务端搜索；
// 真到了几百条这个量级再升级成服务端 search 参数。
const NOTICE_FETCH_SIZE = 40;
const NOTICE_PAGE_SIZE = 6;
const SHOW_LEGACY_GUEST_HOME = false;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
}

function formatStayDates(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return "Not recorded";
  const start = new Date(`${checkIn}T00:00:00`);
  const end = new Date(`${checkOut}T00:00:00`);
  const nights = Math.max(Math.round((end.getTime() - start.getTime()) / 86_400_000), 0);
  const formatter = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short" });
  return `${formatter.format(start)} – ${formatter.format(end)}${nights ? ` (${nights}N)` : ""}`;
}

function disruptionLabel(type: string | null): string {
  if (!type) return "Travel disruption";
  return `${type.charAt(0).toUpperCase()}${type.slice(1)} disruption`;
}

function EmptyState({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="guest-home-empty">
      <span className="guest-home-empty-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="guest-home-empty-title">{title}</p>
      <p className="guest-home-empty-body">{body}</p>
    </div>
  );
}

function DashboardStatIcon({ type }: { type: "hotel" | "alert" | "bell" | "calendar" }) {
  const paths = {
    hotel: <><path d="M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17" /><path d="M15 9h3a1 1 0 0 1 1 1v11M3 21h18M8 7h1M11 7h1M8 11h1M11 11h1M8 15h1M11 15h1" /></>,
    alert: <><path d="M10.3 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>;
}

const HOW_IT_WORKS = [
  {
    step: "1",
    title: "We spot the disruption",
    body: "Weather, flight, or road disruptions are matched against your bookings automatically — usually within 15 minutes.",
  },
  {
    step: "2",
    title: "You get notified",
    body: "A notice lands here and in your email, with the affected dates and what we already know.",
  },
  {
    step: "3",
    title: "Pick an option, we handle the rest",
    body: "Defer, move to another hotel, or cancel for a refund. We notify the hotel and confirm the change for you.",
  },
];

export function GuestHomePage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  const [noticesLoading, setNoticesLoading] = useState(true);
  const [noticeQuery, setNoticeQuery] = useState("");
  const [noticeShown, setNoticeShown] = useState(NOTICE_PAGE_SIZE);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const { cases, loading: casesLoading } = useMyCases();
  const navigate = useNavigate();

  const loadNotifications = useCallback(async () => {
    const res = await notificationsApi.fetchNotifications(1, NOTICE_FETCH_SIZE);
    if (res.code === 0) setNotifications(res.data.list);
    setNoticesLoading(false);
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), NOTICE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  useEffect(() => {
    void bookingsApi.fetchMyBookings().then((res) => {
      if (res.code === 0) setBookings(res.data);
      setBookingsLoading(false);
    });
  }, []);

  const filteredNotifications = useMemo(() => {
    const q = noticeQuery.trim().toLowerCase();
    if (!q) return notifications;
    return notifications.filter((n) =>
      [n.title, n.disruptionTitle, n.body, n.disruptionType].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [notifications, noticeQuery]);

  const visibleNotifications = filteredNotifications.slice(0, noticeShown);
  const activeCases = useMemo(() => cases.filter((item) => item.status !== "closed"), [cases]);
  const unreadNotices = useMemo(() => notifications.filter((item) => !item.readAt).length, [notifications]);
  const upcomingBookings = useMemo(() => bookings
    .filter((item) => item.status !== "cancelled" && new Date(`${item.checkOut}T23:59:59`).getTime() >= Date.now())
    .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()), [bookings]);
  const priorityCase = useMemo(() => [...activeCases].sort((a, b) => {
    if (a.priority === "high" && b.priority !== "high") return -1;
    if (b.priority === "high" && a.priority !== "high") return 1;
    return new Date(a.checkIn ?? a.createdAt).getTime() - new Date(b.checkIn ?? b.createdAt).getTime();
  })[0] ?? null, [activeCases]);
  const nearestCheckIn = upcomingBookings[0]?.checkIn ?? null;
  const dashboardNotices = filteredNotifications.slice(0, noticeShown > NOTICE_PAGE_SIZE ? filteredNotifications.length : 4);

  async function openNotification(id: string, caseId: string | null) {
    setOpeningId(id);
    try {
      await notificationsApi.markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
      if (caseId) navigate(`/cases/${caseId}`);
    } finally {
      setOpeningId(null);
    }
  }

  if (!SHOW_LEGACY_GUEST_HOME) {
    return (
      <GuestDashboardShell onSearch={(query) => { setNoticeQuery(query); setNoticeShown(NOTICE_PAGE_SIZE); }}>
        <div className="guest-dashboard">
          <header className="guest-dashboard-welcome">
            <div><small>TRAVEL OVERVIEW</small><h1>Kia ora, {user?.nickname ?? "traveller"}</h1><p>We are monitoring your upcoming stays and will alert you when something needs your attention.</p></div>
            <span><i aria-hidden="true" />Live monitoring</span>
          </header>

          <section className="guest-dashboard-stats" aria-label="Travel summary">
            <article className="stays"><i><DashboardStatIcon type="hotel" /></i><small>Upcoming stays</small><strong>{bookingsLoading ? "—" : `${upcomingBookings.length} ${upcomingBookings.length === 1 ? "Booking" : "Bookings"}`}</strong><span>active stays</span></article>
            <article className={activeCases.length ? "attention" : ""}><i><DashboardStatIcon type="alert" /></i><small>Action required</small><strong>{casesLoading ? "—" : `${activeCases.length} Open ${activeCases.length === 1 ? "Case" : "Cases"}`}</strong><span>{priorityCase ? `${priorityCase.priority} priority` : "no action required"}</span></article>
            <article className="notices"><i><DashboardStatIcon type="bell" /></i><small>Unread notices</small><strong>{noticesLoading ? "—" : `${unreadNotices} New ${unreadNotices === 1 ? "Update" : "Updates"}`}</strong><span>recent notices</span></article>
            <article className="checkin"><i><DashboardStatIcon type="calendar" /></i><small>Next check-in</small><strong>{nearestCheckIn ? new Date(`${nearestCheckIn}T00:00:00`).toLocaleDateString("en-NZ", { day: "numeric", month: "short" }) : "—"}</strong><span>{nearestCheckIn ? `${Math.max(daysUntil(nearestCheckIn), 0)} days away` : "no upcoming stay"}</span></article>
          </section>

          <section className={`guest-priority ${priorityCase ? "has-action" : "all-clear"}`}>
            {priorityCase ? <>
              <header><span><i aria-hidden="true" />Priority action required: your stay may be affected</span><em>{priorityCase.checkIn ? (daysUntil(priorityCase.checkIn) <= 0 ? "Check-in is due now" : `${daysUntil(priorityCase.checkIn)} days until check-in`) : `${priorityCase.priority} priority`}</em></header>
              <div className="guest-priority-body">
                <figure className={priorityCase.hotelImageUrl ? "" : "no-image"}>
                  {priorityCase.hotelImageUrl
                    ? <img src={priorityCase.hotelImageUrl} alt={priorityCase.hotelName ?? "Affected hotel"} />
                    : <span aria-hidden="true">⌂</span>}
                </figure>
                <div className="guest-priority-content">
                  <div className="guest-priority-meta"><span>{disruptionLabel(priorityCase.disruptionType)}</span>{priorityCase.confirmationNo && <small>Booking Ref: #{priorityCase.confirmationNo}</small>}</div>
                  <h2>{priorityCase.hotelName ?? "Affected booking"} — {priorityCase.disruptionTitle ?? "Travel disruption update"}</h2>
                  <p>{priorityCase.disruptionDescription ?? "A disruption may affect this stay. Review the latest case information and available recovery options."}</p>
                  <dl><div><dt>Stay dates</dt><dd>{formatStayDates(priorityCase.checkIn, priorityCase.checkOut)}</dd></div><div><dt>Disruption type</dt><dd>{disruptionLabel(priorityCase.disruptionType)}</dd></div><div><dt>Case status</dt><dd>{priorityCase.statusLabel}</dd></div></dl>
                </div>
                <div className="guest-priority-actions"><button type="button" onClick={() => navigate(`/cases/${priorityCase.id}`)}>Review recovery options →</button><small>Open your case for the latest update</small></div>
              </div>
            </> : <div className="guest-priority-clear"><i aria-hidden="true">✓</i><div><small>ALL CLEAR</small><h2>No action is required right now</h2><p>We will keep monitoring your upcoming stays and notify you if anything changes.</p></div></div>}
          </section>

          <div className="guest-dashboard-grid">
            <div className="guest-dashboard-main">
              <section className="guest-dashboard-card guest-upcoming">
                <header><div><h2>Upcoming stays</h2><p>Your nearest active reservations</p></div><button type="button" onClick={() => navigate("/bookings")}>View all bookings →</button></header>
                {bookingsLoading ? <EmptyState icon="◌" title="Loading…" body="Fetching your bookings." /> : upcomingBookings.length === 0 ? <EmptyState icon="✓" title="No upcoming stays" body="Future bookings linked to your account will appear here." /> : <div className="guest-upcoming-list">{upcomingBookings.slice(0, 3).map((booking) => <article key={booking.id}><i aria-hidden="true">▦</i><div><strong>{booking.hotelName}</strong><span>{booking.roomTypeName} · {booking.checkIn} → {booking.checkOut}</span></div><small>{booking.confirmationNo}</small><em>{booking.status}</em><button type="button" onClick={() => booking.caseId ? navigate(`/cases/${booking.caseId}`) : navigate("/bookings")}>{booking.caseId ? "View case" : "View stay"} →</button></article>)}</div>}
              </section>

              <section className="guest-dashboard-card guest-notices">
                <header><div><h2>Recent disruption notices</h2><p>Updates connected to your bookings and cases</p></div>{filteredNotifications.length > 4 && <button type="button" onClick={() => setNoticeShown((current) => current > NOTICE_PAGE_SIZE ? NOTICE_PAGE_SIZE : NOTICE_FETCH_SIZE)}>{noticeShown > NOTICE_PAGE_SIZE ? "Show recent" : "View all notices"} →</button>}</header>
                {noticesLoading ? <EmptyState icon="◌" title="Loading…" body="Fetching your notices." /> : dashboardNotices.length === 0 ? <EmptyState icon="✓" title={noticeQuery ? "No matches" : "All quiet for now"} body={noticeQuery ? "Try a different search term." : "New disruption notices will appear here automatically."} /> : <div className="guest-notice-list">{dashboardNotices.map((notice) => <button type="button" key={notice.id} className={!notice.readAt ? "unread" : ""} onClick={() => void openNotification(notice.id, notice.caseId)}><i aria-hidden="true">{notice.readAt ? "✓" : "!"}</i><span><strong>{notice.disruptionTitle ?? notice.title}</strong><small>{notice.body}</small></span><em>{formatDate(notice.sentAt)}</em></button>)}</div>}
              </section>
            </div>

            <aside className="guest-dashboard-side">
              <section className="guest-dashboard-card guest-case-summary"><header><div><h2>Current case status</h2><p>Your active recovery assistance</p></div></header>{priorityCase ? <><strong>{priorityCase.statusLabel}</strong><dl><div><dt>Hotel</dt><dd>{priorityCase.hotelName ?? "Not recorded"}</dd></div><div><dt>Stay</dt><dd>{priorityCase.checkIn ?? "—"} → {priorityCase.checkOut ?? "—"}</dd></div><div><dt>Disruption</dt><dd>{priorityCase.disruptionType ?? "Travel disruption"}</dd></div></dl><button type="button" onClick={() => navigate(`/cases/${priorityCase.id}`)}>Open case conversation →</button></> : <div className="guest-side-clear"><i>✓</i><p>You have no unresolved disruption cases.</p></div>}</section>
              <section className="guest-dashboard-card guest-help-steps"><header><div><h2>How StayRight helps</h2><p>Support when travel plans change</p></div></header><figure><img src="/images/guest-help-illustration.png" alt="A traveller receiving disruption assistance from StayRight NZ" /></figure>{HOW_IT_WORKS.map((step) => <div key={step.step}><i>{step.step}</i><span><strong>{step.title}</strong><small>{step.body}</small></span></div>)}</section>
            </aside>
          </div>
        </div>
      </GuestDashboardShell>
    );
  }

  return (
    <GuestDashboardShell onSearch={(query) => { setNoticeQuery(query); setNoticeShown(NOTICE_PAGE_SIZE); }}>
      <div className="guest-home">
        <header className="guest-home-heading">
          <div><small>TRAVEL OVERVIEW</small><h1>Your StayRight dashboard</h1><p>Track disruption updates, upcoming stays and anything that needs your attention.</p></div>
          <span><i aria-hidden="true" />Live updates</span>
        </header>
        <section className="guest-home-section">
          <h2>Disruption notices</h2>
          <p className="guest-home-hint">Updates push here automatically — no need to refresh.</p>
          {noticesLoading ? (
            <EmptyState icon="⏳" title="Loading…" body="Fetching your notices." />
          ) : filteredNotifications.length === 0 ? (
            <EmptyState
              icon="🌤️"
              title={noticeQuery ? "No matches" : "All quiet for now"}
              body={
                noticeQuery
                  ? "Try a different search term."
                  : "If a disruption ever affects one of your bookings, you'll see it here and in your email within minutes."
              }
            />
          ) : (
            <>
            <ul className="notice-list">
              {visibleNotifications.map((n) => (
                <li
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  className={`notice-card ${n.readAt ? "" : "notice-card-unread"} ${openingId === n.id ? "notice-card-opening" : ""}`}
                  onClick={() => void openNotification(n.id, n.caseId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void openNotification(n.id, n.caseId);
                    }
                  }}
                >
                  {openingId === n.id && <span className="card-opening-spinner" aria-hidden="true" />}
                  <div className="notice-card-tags">
                    {n.disruptionType && <span className="tag tag-type">{n.disruptionType}</span>}
                    {n.caseStatus && <span className="tag tag-status">{n.caseStatus.replace("_", " ")}</span>}
                    {!n.readAt && <span className="notice-dot" aria-label="unread" />}
                  </div>
                  <p className="notice-title">{n.disruptionTitle ?? n.title}</p>
                  <p className="notice-body" title={n.body}>{n.body}</p>
                  <div className="notice-meta">
                    {n.affectedCheckIn && <span>Affects check-in {n.affectedCheckIn}</span>}
                    <span>{formatDate(n.sentAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
            {filteredNotifications.length > noticeShown && (
              <button
                type="button"
                className="guest-home-load-more"
                onClick={() => setNoticeShown((n) => n + NOTICE_PAGE_SIZE)}
              >
                Load more ({filteredNotifications.length - noticeShown} more)
              </button>
            )}
            </>
          )}
        </section>

        <section className="guest-home-section" id="todos">
          <h2>My to-dos</h2>
          <p className="guest-home-hint">Stays here until your case is resolved, even after you've read the notice.</p>
          {casesLoading ? (
            <EmptyState icon="⏳" title="Loading…" body="Fetching your cases." />
          ) : cases.length === 0 ? (
            <EmptyState
              icon="✅"
              title="You're all caught up"
              body="Nothing needs your attention right now. New cases from disruption notices will show up here and stay until resolved."
            />
          ) : (
            <ul className="todo-list">
              {cases.map((c) => {
                const days = c.checkIn ? daysUntil(c.checkIn) : null;
                return (
                  <li
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    className={`todo-card ${openingId === c.id ? "todo-card-opening" : ""}`}
                    onClick={() => {
                      setOpeningId(c.id);
                      navigate(`/cases/${c.id}`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpeningId(c.id);
                        navigate(`/cases/${c.id}`);
                      }
                    }}
                  >
                    {openingId === c.id && <span className="card-opening-spinner" aria-hidden="true" />}
                    <div className="todo-card-header">
                      <span className="todo-hotel">{c.hotelName ?? "Booking"}</span>
                      <div className="todo-card-badges">
                        {days !== null && days >= 0 && (
                          <span className={`todo-countdown ${days <= 2 ? "todo-countdown-soon" : ""}`}>
                            {days === 0 ? "check-in today" : `check-in in ${days}d`}
                          </span>
                        )}
                        <span className={`tag tag-status tag-status-${c.status}`}>{c.statusLabel}</span>
                      </div>
                    </div>
                    <p className="todo-disruption">{c.disruptionTitle}</p>
                    {c.checkIn && c.checkOut && (
                      <p className="todo-dates">
                        {c.checkIn} → {c.checkOut}
                      </p>
                    )}
                    <p className="todo-created">{formatDate(c.createdAt)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="guest-home-how">
          <h2>How it works</h2>
          <div className="how-grid">
            {HOW_IT_WORKS.map((s) => (
              <div key={s.step} className="how-card">
                <span className="how-step">{s.step}</span>
                <p className="how-title">{s.title}</p>
                <p className="how-body">{s.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </GuestDashboardShell>
  );
}
