"""Build a DisruptionEvent narrowly targeted at one specific booking's
check-in day, run identify against it, and write the result to the same
.jsonl handoff file scripts/run_demo.py writes to (replacing its prior
contents, same as run_demo.py -- the file always holds just the latest
detected event).

For demoing/testing "what does the handoff JSON look like for exactly
this one customer" without waiting for real weather or wading through a
wide-radius/wide-window mock's whole affected list.

Rule: weather affecting the check-in day counts as affecting the booking
-- the event's window is exactly the target booking's check-in date. If
another booking at a hotel within radius overlaps that same day (checking
in/out that day, or just staying through it), it gets swept in too and is
reported explicitly; that's a genuine overlap in the seed data, not a bug
in this tool. Pick a different --booking-id if you need strict isolation.

Usage:
    python -m scripts.simulate_targeted_event --guest testguestqq@example.com
    python -m scripts.simulate_targeted_event --booking-id c5754641-3e27-48d5-bf91-7a6f45655b20
"""

from __future__ import annotations

import argparse
from datetime import datetime, time, timezone
from pathlib import Path

from src.detect.models import Severity
from src.detect.open_meteo import Classification, Location, build_disruption_event
from src.identify.db import get_connection
from src.identify.handoff import build_handoff_payloads, write_handoff_messages
from src.identify.matcher import find_affected_bookings

_FIND_BY_BOOKING_ID = """
    SELECT b.id, b.check_in, b.check_out, h.lat, h.lng, h.name
    FROM bookings b
    JOIN hotels h ON h.id = b.hotel_id
    WHERE b.id = %(booking_id)s
"""

_FIND_EARLIEST_BY_GUEST = """
    SELECT b.id, b.check_in, b.check_out, h.lat, h.lng, h.name
    FROM bookings b
    JOIN hotels h ON h.id = b.hotel_id
    JOIN users u ON u.id = b.guest_user_id
    WHERE b.status != 'cancelled' AND (u.email = %(identifier)s OR u.nickname = %(identifier)s)
    ORDER BY b.check_in
    LIMIT 1
"""


def find_target_booking(conn, *, booking_id: str | None, guest: str | None):
    """Returns (booking_id, check_in, check_out, lat, lng, hotel_name) for
    the requested booking, or the requested guest's earliest non-cancelled
    booking.
    """
    with conn.cursor() as cur:
        if booking_id:
            cur.execute(_FIND_BY_BOOKING_ID, {"booking_id": booking_id})
        else:
            cur.execute(_FIND_EARLIEST_BY_GUEST, {"identifier": guest})
        row = cur.fetchone()
    if row is None:
        raise SystemExit("no matching booking found for that --booking-id/--guest")
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--booking-id", help="target this exact booking (uuid)")
    target.add_argument("--guest", help="target this guest's earliest non-cancelled booking (email or nickname)")
    parser.add_argument("--severity", default="high", choices=["low", "medium", "high"])
    parser.add_argument(
        "--output", type=Path, default=Path("output/handoff.jsonl"),
        help="write handoff JSON messages here, one per line, replacing prior contents (default: output/handoff.jsonl)",
    )
    args = parser.parse_args()

    conn = get_connection()
    booking_id, check_in, check_out, lat, lng, hotel_name = find_target_booking(
        conn, booking_id=args.booking_id, guest=args.guest
    )

    window_start = datetime.combine(check_in, time.min, tzinfo=timezone.utc)
    window_end = datetime.combine(check_in, time.max, tzinfo=timezone.utc)

    classification = Classification(True, "storm", Severity(args.severity))
    location = Location(name=hotel_name, lat=lat, lng=lng)
    event = build_disruption_event(
        location, classification, window_start, window_end,
        raw_reading={"wind_gusts_10m": 150, "precipitation": 0, "snowfall": 0},
    )

    print(f"Targeting booking {booking_id} (check-in {check_in} at {hotel_name})")
    affected = find_affected_bookings(event, conn)
    print(f"{len(affected)} booking(s) matched:")
    for booking in affected:
        is_target = str(booking["booking_id"]) == str(booking_id)
        note = " <- target" if is_target else " (also overlaps the target's check-in day -- genuine overlap, not a bug)"
        print(f"  - {booking['booking_id']} / guest {booking['guest_id']} / {booking['hotel_name']} "
              f"({booking['check_in']} -> {booking['check_out']}){note}")

    disruption_event_message, customer_messages = build_handoff_payloads(event, affected)
    write_handoff_messages(args.output, [disruption_event_message, *customer_messages])
    print(f"Wrote 1 disruption_event + {len(customer_messages)} affected_customer message(s) to {args.output}")


if __name__ == "__main__":
    main()
