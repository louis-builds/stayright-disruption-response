"""Affected-customer identification: given a DisruptionEvent, find the
bookings whose stay overlaps the event's time window and whose hotel
falls inside the event's geo radius.

Queries the real C# backend's schema directly (`hotels`/`bookings` in the
shared `stayright` database) rather than a separate toy dataset,
so guest_id/booking_id in the output are real ids the rest of the system
(case lookup, cancellation policy, etc.) already understands.

The SQL layer only narrows candidates by date overlap (portable, simple
SQL every DB understands); the actual distance check runs in Python via
`filter_by_distance` so it stays testable without a live database. Every
query is logged with the triggering event_id so a detection run can be
traced through to the bookings it touched.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from src.detect.models import DisruptionEvent, GeoType

logger = logging.getLogger(__name__)

_CANDIDATE_QUERY = """
    SELECT
        b.id AS booking_id,
        b.hotel_id,
        b.guest_user_id AS guest_id,
        b.check_in,
        b.check_out,
        h.name AS hotel_name,
        h.lat,
        h.lng
    FROM bookings b
    JOIN hotels h ON h.id = b.hotel_id
    WHERE b.status != 'cancelled'
      AND b.check_in <= %(window_end)s
      AND b.check_out >= %(window_start)s
"""


def find_candidate_bookings(
    conn: Any, window_start: date, window_end: date
) -> list[dict[str, Any]]:
    """Bookings whose stay overlaps [window_start, window_end], regardless
    of location. Distance filtering happens afterwards in Python.
    """
    with conn.cursor() as cur:
        cur.execute(_CANDIDATE_QUERY, {"window_start": window_start, "window_end": window_end})
        columns = [col.name for col in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def filter_by_distance(
    candidates: list[dict[str, Any]], center_lat: float, center_lng: float, radius_km: float
) -> list[dict[str, Any]]:
    """Keep only candidates whose property lies within radius_km of center."""
    from src.identify.geo import haversine_km

    return [
        candidate
        for candidate in candidates
        if haversine_km(center_lat, center_lng, candidate["lat"], candidate["lng"]) <= radius_km
    ]


def find_affected_bookings(event: DisruptionEvent, conn: Any) -> list[dict[str, Any]]:
    """Full matching pipeline for one DisruptionEvent: SQL narrows by date
    overlap, then Python narrows by distance from the event's geo center.
    """
    if event.geo.type is not GeoType.POINT:
        raise NotImplementedError(
            f"geo.type={event.geo.type!r} matching is not implemented; only 'point' is supported"
        )

    window_start = event.affects_window.start.date()
    window_end = event.affects_window.end.date()

    logger.info(
        "identify: querying bookings overlapping window",
        extra={"event_id": event.event_id, "window_start": window_start, "window_end": window_end},
    )
    candidates = find_candidate_bookings(conn, window_start, window_end)

    affected = filter_by_distance(
        candidates, event.geo.center.lat, event.geo.center.lng, event.geo.radius_km
    )
    logger.info(
        "identify: matched affected bookings",
        extra={"event_id": event.event_id, "candidate_count": len(candidates), "affected_count": len(affected)},
    )
    return affected
