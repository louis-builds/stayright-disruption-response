import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Pagination, usePagination } from "../../shared/components/Pagination";
import { useAuth } from "../auth";
import { GuestDashboardShell } from "../home/GuestDashboardShell";
import * as api from "./api";
import type { BookingSummary } from "./types";
import "./MyBookingsPage.css";

type BookingFilter = "all" | "confirmed" | "attention" | "rebooked" | "cancelled";
type BookingTone = Exclude<BookingFilter, "all">;
type IconName = "bookings" | "check" | "refresh" | "cancel" | "search" | "shield" | "copy" | "download" | "case" | "calendar" | "guests" | "phone";

const CLOSE_REASON_LABELS: Record<string, string> = {
  改订成功结案: "Rebooking succeeded",
  取消退款完成结案: "Cancelled with refund",
  维持原订: "Kept original booking",
  人工决议结案: "Resolved manually by a coordinator",
  "中断解除-维持原订": "Disruption lifted, booking unchanged",
  客人自行关闭或超时结案: "Closed by guest or timed out",
  误伤关闭: "Closed in error",
  重复案合并关闭: "Merged with a duplicate case",
};

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    bookings: <><path d="M5 3.5h11a2 2 0 0 1 2 2v15H5z"/><path d="M9 8h5M9 12h5M9 16h5M2 20.5h19"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M18.5 16a8 8 0 1 1 .5-8l1 4"/></>,
    cancel: <><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-4"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14"/></>,
    case: <><path d="M7 4h10l3 3v13H7z"/><path d="M17 4v4h4M10 12h7M10 16h5"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/></>,
    guests: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V20"/><path d="M15 6.5a3 3 0 0 1 0 5.8M17 14a4 4 0 0 1 3.5 4v2"/></>,
    phone: <><path d="M5.2 3.8 8.4 3l2 5-2.1 1.4a14.4 14.4 0 0 0 6.3 6.3l1.4-2.1 5 2-.8 3.2a2 2 0 0 1-2 1.5C10.2 19.6 4.4 13.8 3.7 5.8a2 2 0 0 1 1.5-2Z"/></>,
  };
  return <svg className="bookings-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function closeReasonLabel(reason: string): string {
  return CLOSE_REASON_LABELS[reason] ?? reason;
}

function isOpenCase(booking: BookingSummary): boolean {
  return Boolean(booking.caseId && booking.caseStatus !== "closed");
}

function bookingTone(booking: BookingSummary): BookingTone {
  if (booking.status === "cancelled" || booking.refundConfirmed) return "cancelled";
  if (isOpenCase(booking)) return "attention";
  if (booking.status === "rebooked") return "rebooked";
  return "confirmed";
}

function statusLabel(booking: BookingSummary): string {
  const tone = bookingTone(booking);
  if (tone === "attention") return "Action needed";
  return tone.charAt(0).toUpperCase() + tone.slice(1);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function stayNights(booking: BookingSummary): number {
  const start = new Date(`${booking.checkIn}T00:00:00`).getTime();
  const end = new Date(`${booking.checkOut}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-NZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-NZ")}`;
  }
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

function confirmationText(booking: BookingSummary): string {
  return [
    `Confirmation: ${booking.confirmationNo}`,
    `Hotel: ${booking.hotelName}`,
    `Room type: ${booking.roomTypeName}`,
    `Check-in: ${booking.checkIn}`,
    `Check-out: ${booking.checkOut}`,
    `Guests: ${booking.guestsCount}`,
    `Total: ${booking.totalAmount} ${booking.currency}`,
    `Contact: ${booking.contactName} · ${booking.contactPhone}`,
  ].join("\n");
}

function downloadText(filename: string, value: string) {
  const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function BookingOutcome({ booking }: { booking: BookingSummary }) {
  if (!booking.caseId) return null;

  if (booking.refundConfirmed) {
    return (
      <p className="booking-row-update booking-row-update-cancelled">
        Refund confirmed{booking.refundAmount != null ? ` · ${formatMoney(booking.refundAmount, booking.currency)}` : ""}.
      </p>
    );
  }

  if (booking.caseStatus === "closed") {
    return (
      <p className="booking-row-update booking-row-update-closed">
        {booking.caseCloseReason ? closeReasonLabel(booking.caseCloseReason) : "This case has been resolved."}
      </p>
    );
  }

  return <p className="booking-row-update booking-row-update-attention">A linked case needs your review. Open it for the latest update.</p>;
}

export function MyBookingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BookingFilter>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);

  useEffect(() => {
    void api.fetchMyBookings().then((res) => {
      if (res.code === 0) setBookings(res.data);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => ({
    total: bookings.length,
    confirmed: bookings.filter((booking) => bookingTone(booking) === "confirmed").length,
    attention: bookings.filter((booking) => bookingTone(booking) === "attention").length,
    rebooked: bookings.filter((booking) => bookingTone(booking) === "rebooked").length,
    cancelled: bookings.filter((booking) => bookingTone(booking) === "cancelled").length,
    totalValue: bookings.reduce((sum, booking) => sum + booking.totalAmount, 0),
  }), [bookings]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return bookings.filter((booking) => {
      const matchesFilter = filter === "all" || bookingTone(booking) === filter;
      const matchesQuery = !normalizedQuery || [
        booking.hotelName,
        booking.roomTypeName,
        booking.confirmationNo,
        booking.status,
        booking.contactName,
      ].some((field) => field.toLowerCase().includes(normalizedQuery));
      return matchesFilter && matchesQuery;
    });
  }, [bookings, filter, query]);

  const { paged, page, setPage, totalPages } = usePagination(filtered, 6);

  useEffect(() => {
    setPage(1);
  }, [filter, query, setPage]);

  async function handleCopy(booking: BookingSummary) {
    try {
      await copyText(booking.confirmationNo);
      setCopiedId(booking.id);
      window.setTimeout(() => setCopiedId(null), 1400);
    } catch {
      // Clipboard access may be unavailable in an unfocused or restricted browser tab.
    }
  }

  function handleDownload(booking: BookingSummary) {
    downloadText(`${booking.confirmationNo}.txt`, confirmationText(booking));
    setDownloadedId(booking.id);
    window.setTimeout(() => setDownloadedId(null), 1400);
  }

  function exportAll() {
    const content = bookings.map(confirmationText).join("\n\n------------------------------\n\n");
    downloadText("StayRight-NZ-bookings.txt", content);
  }

  if (!user) return null;

  const statCards: Array<{ key: BookingFilter; label: string; value: number; helper: string; icon: IconName }> = [
    { key: "all", label: "Total bookings", value: stats.total, helper: `${formatMoney(stats.totalValue, bookings[0]?.currency ?? "NZD")} total itinerary`, icon: "bookings" },
    { key: "confirmed", label: "Confirmed", value: stats.confirmed, helper: "Ready for check-in", icon: "check" },
    { key: "rebooked", label: "Rebooked", value: stats.rebooked, helper: "Updated stays", icon: "refresh" },
    { key: "cancelled", label: "Cancelled", value: stats.cancelled, helper: "Refunded or closed", icon: "cancel" },
  ];

  const filters: Array<{ key: BookingFilter; label: string; count: number }> = [
    { key: "all", label: "All stays", count: stats.total },
    { key: "confirmed", label: "Confirmed", count: stats.confirmed },
    { key: "attention", label: "Action needed", count: stats.attention },
    { key: "rebooked", label: "Rebooked", count: stats.rebooked },
    { key: "cancelled", label: "Cancelled", count: stats.cancelled },
  ];

  return (
    <GuestDashboardShell active="bookings" onSearch={setQuery}>
      <div className="bookings-page">
        <header className="bookings-hero">
          <div>
            <p className="bookings-overline">Trip overview</p>
            <div className="bookings-title-row">
              <h1>My Bookings</h1>
              <span>{stats.total} total bookings</span>
            </div>
            <p>Manage your confirmed reservations, track disruption-related updates, and download your stay details.</p>
          </div>
          <button type="button" className="bookings-export-button" onClick={exportAll} disabled={bookings.length === 0}>
            <Icon name="download" /> Export all
          </button>
        </header>

        {loading ? (
          <div className="bookings-empty bookings-panel">
            <span className="bookings-loading-spinner" aria-hidden="true" /> Loading bookings…
          </div>
        ) : bookings.length === 0 ? (
          <div className="bookings-empty-state bookings-panel">
            <span className="bookings-empty-visual"><Icon name="bookings" /></span>
            <h2>No bookings on file yet</h2>
            <p>Bookings connected to your account will appear here with their current status and any recovery updates.</p>
          </div>
        ) : (
          <>
            <section className="bookings-stats" aria-label="Booking summary">
              {statCards.map((card) => (
                <button key={card.key} type="button" className={`bookings-stat bookings-stat-${card.key}`} onClick={() => setFilter(card.key)}>
                  <span className="bookings-stat-icon"><Icon name={card.icon} /></span>
                  <span className="bookings-stat-label">{card.label}</span>
                  <strong>{card.value} {card.value === 1 ? "stay" : "stays"}</strong>
                  <small>{card.helper}</small>
                </button>
              ))}
            </section>

            <section className="bookings-protection-strip">
              <span className="bookings-protection-icon"><Icon name="shield" /></span>
              <div>
                <span>StayRight booking monitoring</span>
                <h2>Your stays are checked against active travel disruptions</h2>
                <p>If a booking is affected, its card will show an action-needed status and a direct link to the recovery case.</p>
              </div>
              <strong>{stats.attention > 0 ? `${stats.attention} need${stats.attention === 1 ? "s" : ""} attention` : "All stays up to date"}</strong>
            </section>

            <section className="bookings-toolbar" aria-label="Booking filters">
              <label>
                <Icon name="search" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by hotel, guest or confirmation code…" />
              </label>
              <div className="bookings-filter-list">
                {filters.map((item) => (
                  <button key={item.key} type="button" className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}>
                    {item.label}<span>{item.count}</span>
                  </button>
                ))}
              </div>
            </section>

            {filtered.length === 0 ? (
              <div className="bookings-empty-state bookings-panel">
                <span className="bookings-empty-visual"><Icon name="search" /></span>
                <h2>No matching bookings</h2>
                <p>Try another search term or choose a different status.</p>
                <button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>
              </div>
            ) : (
              <section className="bookings-list" aria-label="Bookings">
                {paged.map((booking) => {
                  const tone = bookingTone(booking);
                  const nights = stayNights(booking);
                  return (
                    <article key={booking.id} className={`booking-row booking-row-${tone}`}>
                      <div className="booking-row-main">
                        <div className="booking-row-badges">
                          <span className={`booking-status booking-status-${tone}`}>{statusLabel(booking)}</span>
                          <span className="booking-reference">{booking.confirmationNo}</span>
                        </div>
                        <h2>{booking.hotelName}</h2>
                        <div className="booking-row-facts">
                          <span><Icon name="calendar" />{formatDate(booking.checkIn)} – {formatDate(booking.checkOut)}{nights > 0 ? ` (${nights}N)` : ""}</span>
                          <span><Icon name="bookings" />{booking.roomTypeName}</span>
                          <span><Icon name="guests" />{booking.guestsCount} {booking.guestsCount === 1 ? "guest" : "guests"}</span>
                          <span><Icon name="phone" />{booking.contactName} · {booking.contactPhone}</span>
                        </div>
                        <BookingOutcome booking={booking} />
                      </div>

                      <div className="booking-row-side">
                        <small>Total stay cost</small>
                        <strong>{formatMoney(booking.totalAmount, booking.currency)}</strong>
                        <div className="booking-row-actions">
                          <button type="button" className={copiedId === booking.id ? "done" : ""} onClick={() => void handleCopy(booking)}>
                            <Icon name="copy" />{copiedId === booking.id ? "Copied" : "Copy"}
                          </button>
                          <button type="button" className={downloadedId === booking.id ? "done" : ""} onClick={() => handleDownload(booking)}>
                            <Icon name="download" />{downloadedId === booking.id ? "Downloaded" : "Confirmation"}
                          </button>
                          {booking.caseId && (
                            <button type="button" className="booking-row-case" onClick={() => navigate(`/cases/${booking.caseId}`)}>
                              <Icon name="case" />Open case
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}

            <div className="bookings-list-footer">
              <span>Showing {filtered.length === 0 ? 0 : (page - 1) * 6 + 1}–{Math.min(page * 6, filtered.length)} of {filtered.length} bookings</span>
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            </div>
          </>
        )}
      </div>
    </GuestDashboardShell>
  );
}
