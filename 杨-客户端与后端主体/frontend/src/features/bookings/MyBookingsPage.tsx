import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../../shared/components/AppShell";
import { RoleTopNav } from "../../shared/components/RoleTopNav";
import { Pagination, usePagination } from "../../shared/components/Pagination";
import { useAuth } from "../auth";
import * as api from "./api";
import type { BookingSummary } from "./types";
import "./MyBookingsPage.css";

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

// 后端把结案原因存成中文业务枚举值（协调员后台按这些值统计改订成功率等指标，不能改），
// 但客人这边全是英文界面——原样展示会漏出没翻译的中文，这里补一层展示层翻译。
const CLOSE_REASON_LABELS: Record<string, string> = {
  改订成功结案: "Rebooking succeeded",
  取消退款完成结案: "Cancelled with refund",
  维持原订: "Kept original booking",
  人工决议结案: "Resolved manually by a coordinator",
  "中断解除-维持原订": "Disruption lifted, booking unchanged",
  客人自行关闭或超时结案: "Closed by guest / timed out",
  误伤关闭: "Closed in error",
  重复案合并关闭: "Merged with a duplicate case",
};

function closeReasonLabel(reason: string): string {
  return CLOSE_REASON_LABELS[reason] ?? reason;
}

function isUpcoming(checkIn: string): boolean {
  const days = Math.round((new Date(checkIn + "T00:00:00").getTime() - Date.now()) / 86_400_000);
  return days >= 0 && days <= 14;
}

function downloadConfirmation(booking: BookingSummary) {
  const lines = [
    `Confirmation: ${booking.confirmationNo}`,
    `Hotel: ${booking.hotelName}`,
    `Room type: ${booking.roomTypeName}`,
    `Check-in: ${booking.checkIn}`,
    `Check-out: ${booking.checkOut}`,
    `Guests: ${booking.guestsCount}`,
    `Total: ${booking.totalAmount} ${booking.currency}`,
    `Contact: ${booking.contactName} · ${booking.contactPhone}`,
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${booking.confirmationNo}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function ResultBadge({ booking }: { booking: BookingSummary }) {
  if (!booking.caseId) return null;

  if (booking.refundConfirmed) {
    return (
      <div className="booking-result booking-result-refund">
        <strong>Cancelled &amp; refunded</strong>
        <p>
          Refund of {booking.refundAmount} {booking.currency} confirmed.
        </p>
      </div>
    );
  }

  if (booking.caseStatus === "closed") {
    return (
      <div className="booking-result booking-result-closed">
        <strong>Case resolved</strong>
        <p>{booking.caseCloseReason ? closeReasonLabel(booking.caseCloseReason) : "This case has been closed."}</p>
      </div>
    );
  }

  return (
    <div className="booking-result booking-result-progress">
      <strong>Rebooking in progress</strong>
      <p>Your case is still being worked on — open the conversation for the latest update.</p>
    </div>
  );
}

export function MyBookingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<BookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);

  useEffect(() => {
    api.fetchMyBookings().then((res) => {
      if (res.code === 0) setBookings(res.data);
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    const total = bookings.length;
    const byStatus = { confirmed: 0, rebooked: 0, cancelled: 0 };
    for (const b of bookings) byStatus[b.status]++;
    return { total, ...byStatus };
  }, [bookings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter((b) =>
      [b.hotelName, b.roomTypeName, b.confirmationNo, b.status].some((f) => f.toLowerCase().includes(q)),
    );
  }, [bookings, query]);

  const { paged, page, setPage, totalPages } = usePagination(filtered);

  async function handleCopy(b: BookingSummary) {
    try {
      await copyText(b.confirmationNo);
      setCopiedId(b.id);
      window.setTimeout(() => setCopiedId(null), 1400);
    } catch {
      // 剪贴板权限被拒绝(比如标签页没聚焦)时静默失败——跟改动前一样不打断用户，
      // 只是不再让这个 rejection 变成未捕获错误。
    }
  }

  function handleDownload(b: BookingSummary) {
    downloadConfirmation(b);
    setDownloadedId(b.id);
    window.setTimeout(() => setDownloadedId(null), 1400);
  }

  if (!user) return null;

  return (
    <AppShell centerContent={<RoleTopNav role={user.role} />}>
      <div className="bookings-page">
        <h2 className="bookings-page-title">My Bookings</h2>
        {loading ? (
          <p className="bookings-empty">
            <span className="bookings-loading-spinner" aria-hidden="true" /> Loading bookings…
          </p>
        ) : bookings.length === 0 ? (
          <div className="bookings-empty-state">
            <span className="bookings-empty-icon" aria-hidden="true">
              🧳
            </span>
            <p className="bookings-empty-title">No bookings on file yet</p>
            <p className="bookings-empty-body">
              This platform doesn't take new bookings directly — once a booking made elsewhere is added to your
              account, it'll show up here with its full details, and any rebooking or refund outcome if a disruption
              ever affects it.
            </p>
          </div>
        ) : (
          <>
          <div className="bookings-stats">
            <div className="bookings-stat">
              <span className="bookings-stat-value">{stats.total}</span>
              <span className="bookings-stat-label">Total bookings</span>
            </div>
            <div className="bookings-stat">
              <span className="bookings-stat-value">{stats.confirmed}</span>
              <span className="bookings-stat-label">Confirmed</span>
              <div className="bookings-stat-bar-track">
                <div className="bookings-stat-bar-fill" style={{ width: `${(stats.confirmed / stats.total) * 100}%` }} />
              </div>
            </div>
            <div className="bookings-stat">
              <span className="bookings-stat-value">{stats.rebooked}</span>
              <span className="bookings-stat-label">Rebooked</span>
              <div className="bookings-stat-bar-track">
                <div className="bookings-stat-bar-fill" style={{ width: `${(stats.rebooked / stats.total) * 100}%` }} />
              </div>
            </div>
            <div className="bookings-stat">
              <span className="bookings-stat-value">{stats.cancelled}</span>
              <span className="bookings-stat-label">Cancelled</span>
              <div className="bookings-stat-bar-track">
                <div className="bookings-stat-bar-fill" style={{ width: `${(stats.cancelled / stats.total) * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="bookings-tip">
            <h3>What happens if a disruption hits one of these bookings?</h3>
            <p>
              We match weather, flight, and road disruptions against your bookings automatically. If one of these stays
              is affected, a notice lands on your Home page and here the card gets a status update — usually a defer,
              a move to another hotel, or a cancellation with refund, all tracked in a case conversation you can reopen
              any time from that card.
            </p>
          </div>

          {bookings.length > 4 && (
            <input
              className="bookings-search"
              type="search"
              placeholder="Search by hotel, room type, confirmation no., or status…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}

          {filtered.length === 0 ? (
            <div className="bookings-empty-state">
              <span className="bookings-empty-icon" aria-hidden="true">🔍</span>
              <p className="bookings-empty-title">No matches</p>
              <p className="bookings-empty-body">Try a different search term.</p>
            </div>
          ) : (
          <div className="bookings-grid">
          {paged.map((b) => (
            <div key={b.id} className={`booking-card ${isUpcoming(b.checkIn) ? "booking-card-upcoming" : ""}`}>
              <div className="booking-card-header">
                <div>
                  <p className="booking-hotel">{b.hotelName}</p>
                  <p className="booking-room">{b.roomTypeName}</p>
                </div>
                <span className={`tag tag-status tag-status-${b.status === "rebooked" ? "in_progress" : b.status === "cancelled" ? "closed" : "pending"}`}>
                  {b.status}
                </span>
              </div>

              <div className="booking-details">
                <div>
                  <span className="booking-label">Check-in → Check-out</span>
                  <span>
                    {b.checkIn} → {b.checkOut}
                  </span>
                </div>
                <div>
                  <span className="booking-label">Guests</span>
                  <span>{b.guestsCount}</span>
                </div>
                <div>
                  <span className="booking-label">Total</span>
                  <span>
                    {b.totalAmount} {b.currency}
                  </span>
                </div>
                <div>
                  <span className="booking-label">Confirmation No.</span>
                  <span>{b.confirmationNo}</span>
                </div>
                <div>
                  <span className="booking-label">Contact</span>
                  <span>
                    {b.contactName} · {b.contactPhone}
                  </span>
                </div>
              </div>

              <ResultBadge booking={b} />

              <div className="booking-actions">
                <button
                  type="button"
                  className={copiedId === b.id ? "booking-action-done" : ""}
                  onClick={() => void handleCopy(b)}
                >
                  {copiedId === b.id ? "Copied ✓" : "Copy confirmation"}
                </button>
                <button
                  type="button"
                  className={downloadedId === b.id ? "booking-action-done" : ""}
                  onClick={() => handleDownload(b)}
                >
                  {downloadedId === b.id ? "Downloaded ✓" : "Download"}
                </button>
                {b.caseId && (
                  <button type="button" className="booking-case-link" onClick={() => navigate(`/cases/${b.caseId}`)}>
                    View case conversation →
                  </button>
                )}
              </div>
            </div>
          ))}
          </div>
          )}
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </AppShell>
  );
}
