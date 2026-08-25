"""Demo mode: repeatedly poll one location's real weather, forever, and
run the full detect -> identify pipeline whenever something is risky.

Real weather rarely cooperates on demo day, so one designated iteration
(--mock-at, default the 3rd) substitutes a canned high-severity storm
reading for the real Open-Meteo call instead of skipping the API — every
other iteration still hits the real API and prints whatever it gets back,
same code path either way (classify() can't tell the difference between
a real and a mocked reading).

Every detected event is appended to a .jsonl handoff file (one JSON
message per line: the disruption_event once, then one affected_customer
message per matched booking) for another system to read/tail.

Usage:
    docker compose up -d
    python -m scripts.run_demo
    python -m scripts.run_demo --interval 10 --mock-at 3 --iterations 6
    python -m scripts.run_demo --output output/handoff.jsonl
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.detect.open_meteo import (
    DEFAULT_LOCATIONS,
    Location,
    build_disruption_event,
    classify,
    fetch_weather,
)
from src.identify.db import apply_sql_file, get_connection
from src.identify.matcher import find_affected_bookings

SEED_DATA_DIR = Path(__file__).resolve().parent.parent / "seed_data"

# Comfortably past the storm thresholds in open_meteo.py so classify()
# always calls this a high-severity storm.
MOCK_STORM_PAYLOAD = {"current": {"wind_gusts_10m": 150, "precipitation": 0, "snowfall": 0}}

# Wide enough that the mock event overlaps the fixed 2026-08 dates in
# seed_data/seed.sql regardless of exactly which day the demo runs on;
# a real detect run would use open_meteo.py's much narrower default.
DEMO_WINDOW_HOURS = 24 * 7


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_handoff_payloads(event, affected_bookings: list[dict]) -> tuple[dict, list[dict]]:
    """Format for handing a detected event off to the colleague's system:
    the disruption_event is sent exactly once, not repeated per customer.
    Each affected customer gets its own lightweight message that just
    references the event by id, plus its own guest_id/booking_id.

    Returns (disruption_event_message, affected_customer_messages), each
    meant to be written out as its own line in the .jsonl handoff file.
    """
    disruption_event_message = {
        "disruption_event": {
            "id": event.event_id,
            "type": event.source.value,
            "event_subtype": event.event_type,
            "severity": event.severity.value,
            "detected_at": _iso_z(event.detected_at),
            "affects_window": {
                "start": _iso_z(event.affects_window.start),
                "end": _iso_z(event.affects_window.end),
            },
            "geo": {
                "lat": event.geo.center.lat,
                "lng": event.geo.center.lng,
                "radius_km": event.geo.radius_km,
            },
            "raw_signal": {
                "wind_gusts_kmh": event.raw_payload.get("wind_gusts_10m", 0),
                "precipitation_mm": event.raw_payload.get("precipitation", 0),
                "snowfall_cm": event.raw_payload.get("snowfall", 0),
            },
        }
    }
    affected_customer_messages = [
        {
            "disruption_event_id": event.event_id,
            "guest_id": booking["guest_id"],
            "booking_id": booking["booking_id"],
        }
        for booking in affected_bookings
    ]
    return disruption_event_message, affected_customer_messages


def _find_location(name: str) -> Location:
    for loc in DEFAULT_LOCATIONS:
        if loc.name.lower() == name.lower():
            return loc
    names = [loc.name for loc in DEFAULT_LOCATIONS]
    raise ValueError(f"unknown location {name!r}; choices: {names}")


def append_handoff_messages(output_path: Path, messages: list[dict]) -> None:
    """Append each message as its own line to a .jsonl file (one JSON
    object per line), so the colleague's side can tail/read it without
    waiting for the whole run to finish or parsing console output.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("a", encoding="utf-8") as f:
        for message in messages:
            f.write(json.dumps(message) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--location", default="Queenstown", help="fixed location to poll (default: Queenstown)")
    parser.add_argument("--interval", type=float, default=10.0, help="seconds between polls (default: 10)")
    parser.add_argument(
        "--mock-at", type=int, default=3,
        help="1-indexed iteration to inject a mock storm reading on; 0 disables mocking (default: 3)",
    )
    parser.add_argument("--iterations", type=int, default=0, help="stop after N iterations (default: run forever)")
    parser.add_argument("--seed", action="store_true", help="(re)apply schema.sql and seed.sql before starting")
    parser.add_argument(
        "--output", type=Path, default=Path("output/handoff.jsonl"),
        help="append handoff JSON messages here, one per line (default: output/handoff.jsonl)",
    )
    args = parser.parse_args()

    location = _find_location(args.location)
    conn = get_connection()
    output_path = args.output

    if args.seed:
        print("Applying schema + seed data...")
        apply_sql_file(conn, SEED_DATA_DIR / "schema.sql")
        apply_sql_file(conn, SEED_DATA_DIR / "seed.sql")

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

            if classification.is_risky:
                now = datetime.now(timezone.utc)
                event = build_disruption_event(
                    location, classification, now, now + timedelta(hours=DEMO_WINDOW_HOURS), raw_payload["current"]
                )
                print(f"  DisruptionEvent {event.event_id} -> querying affected bookings...")
                affected = find_affected_bookings(event, conn)
                if affected:
                    print(f"  {len(affected)} affected booking(s):")
                    for booking in affected:
                        print(f"    - {booking['booking_id']} / guest {booking['guest_id']} "
                              f"/ {booking['property_name']} ({booking['check_in']} -> {booking['check_out']})")
                    disruption_event_message, customer_messages = build_handoff_payloads(event, affected)
                    append_handoff_messages(output_path, [disruption_event_message, *customer_messages])
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
