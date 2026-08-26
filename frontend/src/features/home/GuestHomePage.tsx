import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { getNavLinksForRole } from "../../shared/components/navLinks";
import * as notificationsApi from "../notifications/api";
import type { NotificationItem } from "../notifications/types";
import { useMyCases } from "../cases/useMyCases";
import "./GuestHomePage.css";

const NOTICE_POLL_MS = 20_000;
// ponytail: 一次多拉 40 条再前端搜索/分页，客人自己的通知列表量级不会大到需要真·服务端搜索；
// 真到了几百条这个量级再升级成服务端 search 参数。
const NOTICE_FETCH_SIZE = 40;
const NOTICE_PAGE_SIZE = 6;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86_400_000);
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
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
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

  const filteredNotifications = useMemo(() => {
    const q = noticeQuery.trim().toLowerCase();
    if (!q) return notifications;
    return notifications.filter((n) =>
      [n.title, n.disruptionTitle, n.body, n.disruptionType].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [notifications, noticeQuery]);

  const visibleNotifications = filteredNotifications.slice(0, noticeShown);

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

  return (
    <AppShell navLinks={getNavLinksForRole("guest").filter((l) => l.label !== "Profile")}>
      <div className="guest-home">
        <section className="guest-home-section">
          <h2>Disruption notices</h2>
          <p className="guest-home-hint">Updates push here automatically — no need to refresh.</p>
          {notifications.length > NOTICE_PAGE_SIZE && (
            <input
              className="guest-home-search"
              type="search"
              placeholder="Search notices by hotel, disruption type, or message…"
              value={noticeQuery}
              onChange={(e) => {
                setNoticeQuery(e.target.value);
                setNoticeShown(NOTICE_PAGE_SIZE);
              }}
            />
          )}
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
                  <p className="notice-body">{n.body}</p>
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
    </AppShell>
  );
}
