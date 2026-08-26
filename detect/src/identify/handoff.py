"""Format and write the JSON handed off to the colleague's system after a
DisruptionEvent has been matched against affected bookings. Shared by
scripts/run_demo.py and scripts/simulate_targeted_event.py so both write
the exact same wire format.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_handoff_payloads(event: Any, affected_bookings: list[dict]) -> tuple[dict, list[dict]]:
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
            # guest_id/booking_id come back from psycopg as UUID objects
            # (real Postgres uuid columns) -- stringify for JSON.
            "guest_id": str(booking["guest_id"]),
            "booking_id": str(booking["booking_id"]),
        }
        for booking in affected_bookings
    ]
    return disruption_event_message, affected_customer_messages


def write_handoff_messages(output_path: Path, messages: list[dict]) -> None:
    """Write each message as its own line to a .jsonl file (one JSON object
    per line), replacing whatever was there before -- the file always
    holds only the latest detected event, not a growing log, so the
    colleague's side always reads the current state rather than having to
    reconcile against stale entries from earlier runs.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        for message in messages:
            f.write(json.dumps(message) + "\n")
