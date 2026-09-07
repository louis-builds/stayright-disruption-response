"""Demo mode: repeatedly poll one location's real weather, forever, and
run the full detect -> identify pipeline whenever something is risky.

Real weather rarely cooperates on demo day, so one designated iteration
(--mock-at, default the 3rd) substitutes a canned high-severity storm
reading for the real Open-Meteo call instead of skipping the API — every
other iteration still hits the real API and prints whatever it gets back,
same code path either way (classify() can't tell the difference between
a real and a mocked reading). The mocked tick also narrows its window to
exactly MOCK_TARGET_BOOKING_ID's check-in day (instead of the wide
DEMO_WINDOW_HOURS a real tick uses), so the demo reliably shows one
specific booking as affected rather than everything within 30 days —
other bookings that genuinely overlap that same day still show up too,
flagged as such.

Every detected event is written to a .jsonl handoff file (one JSON
message per line: the disruption_event once, then one affected_customer
message per matched booking) for another system to read. Each write
replaces the file's previous contents -- it always holds only the most
recently detected event, not a growing log.

Usage:
    docker compose up -d
    python -m scripts.run_demo
    python -m scripts.run_demo --interval 10 --mock-at 3 --iterations 6
    python -m scripts.run_demo --output output/handoff.jsonl
"""

from __future__ import annotations

import argparse
import time
from datetime import datetime, time as time_of_day, timedelta, timezone
from pathlib import Path

from scripts.simulate_targeted_event import find_target_booking
from src.detect.dedup import should_report
from src.detect.open_meteo import (
    DEFAULT_LOCATIONS,
    Location,
    build_disruption_event,
    classify,
    fetch_weather,
)
from src.identify.db import get_connection
from src.identify.handoff import build_handoff_payloads, write_handoff_messages
from src.identify.matcher import find_affected_bookings

# weather_code 96 = thunderstorm with hail -> classify() calls this a
# high-severity storm (see SEVERE_WEATHER_CODES in open_meteo.py).
MOCK_STORM_PAYLOAD = {"current": {"weather_code": 96, "precipitation": 20, "snowfall": 0}}

# Wide enough to reliably overlap the C# backend's seed bookings (their
# check-in dates are relative offsets from whenever they were last seeded,
# see backend/SeedData/bookings.json) regardless of exactly when the demo
# runs; a real detect run would use open_meteo.py's much narrower default.
DEMO_WINDOW_HOURS = 24 * 30

# The mocked tick narrows its window to exactly this booking's check-in
# day instead of the wide DEMO_WINDOW_HOURS -- weather affecting the
# check-in day counts as affecting the booking. Looked up by id (not a
# hardcoded date) so it stays correct even if the backend gets reseeded on
# a different day. Currently Test Guest QQ's earliest Auckland booking;
# change this to target a different one.
MOCK_TARGET_BOOKING_ID = "9d77e2ec-4436-4369-bb06-6bb332043575"


def _find_location(name: str) -> Location:
    for loc in DEFAULT_LOCATIONS:
        if loc.name.lower() == name.lower():
            return loc
    names = [loc.name for loc in DEFAULT_LOCATIONS]
    raise ValueError(f"unknown location {name!r}; choices: {names}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--location", default="Auckland", help="fixed location to poll (default: Auckland)")
    parser.add_argument("--interval", type=float, default=10.0, help="seconds between polls (default: 10)")
    parser.add_argument(
        "--mock-at", type=int, default=3,
        help="1-indexed iteration to inject a mock storm reading on; 0 disables mocking (default: 3)",
    )
    parser.add_argument("--iterations", type=int, default=0, help="stop after N iterations (default: run forever)")
    parser.add_argument(
        "--output", type=Path, default=Path("output/handoff.jsonl"),
        help="write handoff JSON messages here, one per line, replacing prior contents (default: output/handoff.jsonl)",
    )
    parser.add_argument(
        "--dedup-cooldown-minutes", type=float, default=60.0,
        help="skip re-reporting the same location+event type within this window unless severity "
             "escalates; persisted to disk so it survives across separate runs, not just one "
             "long-lived process (default: 60; 0 disables de-dup entirely)",
    )
    args = parser.parse_args()

    location = _find_location(args.location)
    conn = get_connection()
    output_path = args.output

    print(f"Demo mode: polling {location.name} every {args.interval:g}s (Ctrl+C to stop)")
    if args.mock_at:
        print(f"  -> iteration {args.mock_at} will use a mocked storm reading instead of a real API call")

    iteration = 0
    try:
        while True:
            iteration += 1
            timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
            is_mocked = iteration == args.mock_at

            if is_mocked:
                print(f"[{timestamp}] #{iteration} MOCK reading injected for {location.name}")
                raw_payload = MOCK_STORM_PAYLOAD
            else:
                print(f"[{timestamp}] #{iteration} polling real Open-Meteo for {location.name}...")
                raw_payload = fetch_weather(location.lat, location.lng)

            classification = classify(raw_payload)
            print(f"  classify -> {classification.event_type} "
                  f"(risky={classification.is_risky}, severity={classification.severity})")

            if classification.is_risky and args.dedup_cooldown_minutes > 0 and not should_report(
                output_path.parent / ".dedup_state.json", location.name, classification.event_type,
                classification.severity, args.dedup_cooldown_minutes, datetime.now(timezone.utc),
            ):
                print(f"  Skipped -- same {classification.event_type} for {location.name} already reported "
                      f"within the last {args.dedup_cooldown_minutes:g} min (no severity escalation).")
            elif classification.is_risky:
                if is_mocked:
                    _, target_check_in, *_ = find_target_booking(conn, booking_id=MOCK_TARGET_BOOKING_ID, guest=None)
                    window_start = datetime.combine(target_check_in, time_of_day.min, tzinfo=timezone.utc)
                    window_end = datetime.combine(target_check_in, time_of_day.max, tzinfo=timezone.utc)
                    print(f"  Narrowed to booking {MOCK_TARGET_BOOKING_ID}'s check-in day ({target_check_in})")
                else:
                    now = datetime.now(timezone.utc)
                    window_start, window_end = now, now + timedelta(hours=DEMO_WINDOW_HOURS)

                event = build_disruption_event(location, classification, window_start, window_end, raw_payload["current"])
                print(f"  DisruptionEvent {event.event_id} -> querying affected bookings...")
                affected = find_affected_bookings(event, conn)
                if affected:
                    print(f"  {len(affected)} affected booking(s):")
                    for booking in affected:
                        note = ""
                        if is_mocked and str(booking["booking_id"]) != MOCK_TARGET_BOOKING_ID:
                            note = "  (overlaps the target's check-in day -- genuine overlap, not a bug)"
                        print(f"    - {booking['booking_id']} / guest {booking['guest_id']} "
                              f"/ {booking['hotel_name']} ({booking['check_in']} -> {booking['check_out']}){note}")
                    disruption_event_message, customer_messages = build_handoff_payloads(event, affected)
                    write_handoff_messages(output_path, [disruption_event_message, *customer_messages])
                    print(f"  Wrote 1 disruption_event + {len(customer_messages)} affected_customer "
                          f"message(s) to {output_path}")
                else:
                    print("  No bookings affected.")

            if args.iterations and iteration >= args.iterations:
                print("Reached iteration limit, stopping.")
                break

            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
