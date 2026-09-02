"""The one place a DisruptionEvent gets assembled.

Every detect adapter (weather, volcano, flight, road) answers the same
question in its own units -- "which circle on the map, over which time
window, is disrupted, and how badly" -- and then calls `build_event` to
turn that answer into the shared DisruptionEvent shape. Keeping the
assembly in a single function is what stops the four sources from
drifting into four subtly different event shapes.

`build_event` only knows the unified envelope. Source-specific evidence
goes in `raw_payload` untouched; downstream code (identify, handoff)
never branches on `source`, so nothing here needs to either.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, NamedTuple

from src.detect.models import (
    DisruptionEvent,
    EventSource,
    Geo,
    GeoPoint,
    GeoType,
    Severity,
    TimeWindow,
)


class Classification(NamedTuple):
    """A source's verdict on one raw signal: is it worth an event, and if
    so what kind and how severe. `is_risky=False` is the "no event"
    sentinel (event_type "none", severity LOW) -- adapters skip those.
    Shared across every detect adapter so the classify step looks the
    same everywhere.
    """

    is_risky: bool
    event_type: str
    severity: Severity


def build_event(
    *,
    source: EventSource,
    event_type: str,
    severity: Severity,
    window_start: datetime,
    window_end: datetime,
    center_lat: float,
    center_lng: float,
    radius_km: float,
    raw_payload: dict[str, Any],
    detected_at: datetime | None = None,
) -> DisruptionEvent:
    """Assemble one DisruptionEvent from a source's (window, circle,
    severity) answer plus its opaque evidence dict.

    `window_start`/`window_end` must be timezone-aware UTC with start <
    end (TimeWindow enforces this). `detected_at` defaults to now.
    """
    return DisruptionEvent(
        source=source,
        event_type=event_type,
        severity=severity,
        detected_at=detected_at or datetime.now(timezone.utc),
        affects_window=TimeWindow(start=window_start, end=window_end),
        geo=Geo(
            type=GeoType.POINT,
            center=GeoPoint(lat=center_lat, lng=center_lng),
            radius_km=radius_km,
        ),
        raw_payload=raw_payload,
    )
