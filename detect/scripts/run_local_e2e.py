"""Manual end-to-end run: detect -> identify, against real Open-Meteo and
a real local Postgres. Not part of the automated pytest suite (that suite
must run without network or a live database) — this script is for
demoing/verifying the two modules wired together.

Usage:
    docker compose up -d
    python -m scripts.run_local_e2e            # real Open-Meteo poll
    python -m scripts.run_local_e2e --simulate  # skip Open-Meteo, use a
                                                 # canned storm event over
                                                 # Queenstown instead
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from src.detect.models import DisruptionEvent, EventSource, Geo, GeoPoint, GeoType, Severity, TimeWindow
from src.detect.open_meteo import DEFAULT_LOCATIONS, detect_events
from src.identify.db import get_connection
from src.identify.matcher import find_affected_bookings


def simulated_storm_event() -> DisruptionEvent:
    """A canned high-severity storm over Queenstown (matches the real
    Queenstown Lakeview Hotel's coordinates), for demoing without waiting
    on real weather. Window is wide (30 days) to reliably overlap the C#
    backend's seed bookings, whose check-in dates are relative offsets
    from whenever they were last seeded (backend/SeedData/bookings.json).
    """
    now = datetime.now(timezone.utc)
    return DisruptionEvent(
        source=EventSource.WEATHER,
        event_type="storm",
        severity=Severity.HIGH,
        detected_at=now,
        affects_window=TimeWindow(start=now, end=now + timedelta(days=30)),
        geo=Geo(type=GeoType.POINT, center=GeoPoint(lat=-45.0312, lng=168.6626), radius_km=30),
        raw_payload={"note": "simulated event for local e2e demo"},
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--simulate", action="store_true", help="use a canned storm event instead of polling Open-Meteo"
    )
    args = parser.parse_args()

    conn = get_connection()

    if args.simulate:
        events = [simulated_storm_event()]
        print("Using simulated storm event (Queenstown, 30km radius).")
    else:
        print(f"Polling Open-Meteo for {len(DEFAULT_LOCATIONS)} locations...")
        events = detect_events()

    if not events:
        print("No risky weather events detected. Nothing to identify.")
        return

    for event in events:
        print(f"\nDisruptionEvent {event.event_id}: {event.event_type} ({event.severity}) "
              f"at ({event.geo.center.lat}, {event.geo.center.lng})")
        affected = find_affected_bookings(event, conn)
        if not affected:
            print("  No bookings affected.")
            continue
        print(f"  {len(affected)} affected booking(s):")
        for booking in affected:
            print(f"    - {booking['booking_id']} / guest {booking['guest_id']} "
                  f"/ {booking['hotel_name']} ({booking['check_in']} -> {booking['check_out']})")


if __name__ == "__main__":
    main()
