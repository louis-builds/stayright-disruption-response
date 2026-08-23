"""Demo mode: repeatedly poll one location's real weather, forever, and
run the full detect -> identify pipeline whenever something is risky.

Real weather rarely cooperates on demo day, so one designated iteration
(--mock-at, default the 3rd) substitutes a canned high-severity storm
reading for the real Open-Meteo call instead of skipping the API — every
other iteration still hits the real API and prints whatever it gets back,
same code path either way (classify() can't tell the difference between
a real and a mocked reading).

Usage:
    docker compose up -d
    python -m scripts.run_demo
    python -m scripts.run_demo --interval 10 --mock-at 3 --iterations 6
"""

from __future__ import annotations

import argparse
import time
from datetime import datetime, timezone
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
MOCK_STORM_PAYLOAD = {"current": {"wind_gusts_10m": 130, "precipitation": 0, "snowfall": 0}}

# Wide enough that the mock event overlaps the fixed 2026-08 dates in
# seed_data/seed.sql regardless of exactly which day the demo runs on;
# a real detect run would use open_meteo.py's much narrower default.
DEMO_WINDOW_HOURS = 24 * 7


def _find_location(name: str) -> Location:
    for loc in DEFAULT_LOCATIONS:
        if loc.name.lower() == name.lower():
            return loc
    names = [loc.name for loc in DEFAULT_LOCATIONS]
    raise ValueError(f"unknown location {name!r}; choices: {names}")


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
    args = parser.parse_args()

    location = _find_location(args.location)
    conn = get_connection()

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
                event = build_disruption_event(
                    location, raw_payload, classification, window_hours=DEMO_WINDOW_HOURS
                )
                print(f"  DisruptionEvent {event.event_id} -> querying affected bookings...")
                affected = find_affected_bookings(event, conn)
                if affected:
                    print(f"  {len(affected)} affected booking(s):")
                    for booking in affected:
                        print(f"    - {booking['booking_id']} / guest {booking['guest_id']} "
                              f"/ {booking['property_name']} ({booking['check_in']} -> {booking['check_out']})")
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
