"""Weather anomaly detection: fetch Open-Meteo forecasts and normalise
risky conditions into DisruptionEvent objects.

The risk thresholds in `classify` are a placeholder, same as the old
prototype's `is_risky()` — they exist so the pipeline can be exercised
end to end, not as approved alerting policy. Replace them with real
thresholds before this goes anywhere near production.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple

import requests

from src.detect.models import (
    DisruptionEvent,
    EventSource,
    Geo,
    GeoPoint,
    GeoType,
    Severity,
    TimeWindow,
)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# Radius is a rough MVP guess at "area a single weather reading represents",
# not a validated impact radius.
DEFAULT_RADIUS_KM = 30.0

WIND_GUST_STORM_KMH = 90.0
PRECIPITATION_FLOOD_MM = 10.0
SNOWFALL_HEAVY_SNOW_CM = 5.0


class Location(NamedTuple):
    name: str
    lat: float
    lng: float
    radius_km: float = DEFAULT_RADIUS_KM


# Fixed set of NZ locations, matching the old prototype's coverage.
# Adding a new location here is the only change needed to monitor it.
DEFAULT_LOCATIONS: list[Location] = [
    Location("Queenstown", -45.0312, 168.6626),
    Location("Auckland", -36.8485, 174.7633),
    Location("Wellington", -41.2865, 174.7762),
    Location("Christchurch", -43.5321, 172.6362),
]


def fetch_weather(lat: float, lng: float, *, timeout: float = 10.0) -> dict[str, Any]:
    """Call Open-Meteo's forecast API for one point. Returns the raw JSON."""
    params = {
        "latitude": lat,
        "longitude": lng,
        "current": "wind_gusts_10m,precipitation,snowfall",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "forecast_days": 1,
    }
    response = requests.get(OPEN_METEO_URL, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


class Classification(NamedTuple):
    is_risky: bool
    event_type: str
    severity: Severity


def classify(raw_payload: dict[str, Any]) -> Classification:
    """Decide whether a raw Open-Meteo payload represents a risky event.

    Placeholder thresholds only — see module docstring.
    """
    current = raw_payload.get("current", {})
    wind_gusts = current.get("wind_gusts_10m", 0) or 0
    precipitation = current.get("precipitation", 0) or 0
    snowfall = current.get("snowfall", 0) or 0

    if snowfall >= SNOWFALL_HEAVY_SNOW_CM:
        return Classification(True, "heavy_snow", Severity.HIGH)
    if precipitation >= PRECIPITATION_FLOOD_MM:
        severity = Severity.HIGH if precipitation >= PRECIPITATION_FLOOD_MM * 2 else Severity.MEDIUM
        return Classification(True, "flood", severity)
    if wind_gusts >= WIND_GUST_STORM_KMH:
        severity = Severity.HIGH if wind_gusts >= WIND_GUST_STORM_KMH * 1.5 else Severity.MEDIUM
        return Classification(True, "storm", severity)

    return Classification(False, "none", Severity.LOW)


def build_disruption_event(
    location: Location,
    raw_payload: dict[str, Any],
    classification: Classification,
    *,
    detected_at: datetime | None = None,
    window_hours: float = 6.0,
) -> DisruptionEvent:
    """Normalise a risky Open-Meteo reading into a DisruptionEvent."""
    now = detected_at or datetime.now(timezone.utc)
    return DisruptionEvent(
        source=EventSource.WEATHER,
        event_type=classification.event_type,
        severity=classification.severity,
        detected_at=now,
        affects_window=TimeWindow(start=now, end=now + timedelta(hours=window_hours)),
        geo=Geo(
            type=GeoType.POINT,
            center=GeoPoint(lat=location.lat, lng=location.lng),
            radius_km=location.radius_km,
        ),
        raw_payload={"location": location.name, **raw_payload},
    )


def detect_events(
    locations: list[Location] | None = None,
    *,
    fetch: Any = fetch_weather,
) -> list[DisruptionEvent]:
    """Poll every configured location and return DisruptionEvents for the
    ones currently at risk. Locations with normal weather produce nothing.
    """
    events: list[DisruptionEvent] = []
    for location in locations or DEFAULT_LOCATIONS:
        raw_payload = fetch(location.lat, location.lng)
        classification = classify(raw_payload)
        if classification.is_risky:
            events.append(build_disruption_event(location, raw_payload, classification))
    return events
