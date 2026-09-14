"""Manual end-to-end run: detect -> identify, against the real upstream
APIs and the shared remote stayright DB. Not part of the automated pytest
suite (that suite must run without network or a live database) -- this
script is for demoing/verifying the modules wired together.

Usage:
    # open the SSM tunnel first (see docs/DATABASE_ACCESS.md), then:
    python -m scripts.run_local_e2e                     # poll Open-Meteo (weather)
    python -m scripts.run_local_e2e --simulate          # canned Queenstown storm, no API call
    python -m scripts.run_local_e2e --source volcano    # poll GeoNet volcano alert levels
    python -m scripts.run_local_e2e --source flight      # poll AeroDataBox flight status (needs RAPIDAPI_KEY)
    python -m scripts.run_local_e2e --source road        # poll NZTA road-closure feed
    python -m scripts.run_local_e2e --source all         # every source

Every source normalises to the same DisruptionEvent, so identify runs
the same code path regardless of which one produced the event.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from src.detect.geonet_volcano import detect_volcano_events
from src.detect.models import DisruptionEvent, EventSource, Geo, GeoPoint, GeoType, Severity, TimeWindow
from src.detect.nzta_road import detect_road_events
from src.detect.flight_status import detect_flight_events
from src.detect.open_meteo import DEFAULT_LOCATIONS, detect_events
from src.identify.db import get_connection
from src.identify.matcher import find_affected_bookings

SOURCE_CHOICES = ["weather", "volcano", "flight", "road", "all"]


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


def collect_events(source: str, *, simulate: bool) -> list[DisruptionEvent]:
    events: list[DisruptionEvent] = []
    want = SOURCE_CHOICES[:-1] if source == "all" else [source]

    if "weather" in want:
        if simulate:
            print("weather: using simulated storm event (Queenstown, 30km radius).")
            events.append(simulated_storm_event())
        else:
            print(f"weather: polling Open-Meteo for {len(DEFAULT_LOCATIONS)} locations...")
            events.extend(detect_events())
    if "volcano" in want:
        print("volcano: polling GeoNet /volcano/val...")
        events.extend(detect_volcano_events())
    if "flight" in want:
        print("flight: polling OAG flight status for monitored airports...")
        events.extend(detect_flight_events())
    if "road" in want:
        print("road: polling NZTA traffic events...")
        events.extend(detect_road_events())
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--source", choices=SOURCE_CHOICES, default="weather",
        help="which detector(s) to run (default: weather)",
    )
    parser.add_argument(
        "--simulate", action="store_true",
        help="weather only: use a canned storm event instead of polling Open-Meteo",
    )
    args = parser.parse_args()

    conn = get_connection()
    events = collect_events(args.source, simulate=args.simulate)

    if not events:
        print("No regional-scale disruption events detected. Nothing to identify.")
        return

    for event in events:
        print(f"\nDisruptionEvent {event.event_id}: {event.source.value}/{event.event_type} "
              f"({event.severity.value}) at ({event.geo.center.lat}, {event.geo.center.lng}) "
              f"r={event.geo.radius_km}km")
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
