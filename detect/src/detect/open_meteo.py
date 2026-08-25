"""Weather anomaly detection: fetch an Open-Meteo hourly forecast and
normalise the hours that clear the risk thresholds into a DisruptionEvent
whose affects_window reflects when the location is actually forecast to
be at risk — not a flat placeholder offset from "now".

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

# Forecast accuracy degrades the further out it goes, and Open-Meteo tops
# out at 16 days anyway — this only ever tries to catch near-term bookings,
# which is the honest limit of what a weather forecast can tell you.
DEFAULT_FORECAST_DAYS = 7

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
    """Call Open-Meteo for one point's current reading only (no forecast).
    Used where a single up-to-the-minute reading is enough, e.g. scripts/run_demo.py.
    """
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


def fetch_forecast(lat: float, lng: float, *, forecast_days: int = DEFAULT_FORECAST_DAYS, timeout: float = 10.0) -> dict[str, Any]:
    """Call Open-Meteo's hourly forecast API for one point. Returns the raw JSON."""
    params = {
        "latitude": lat,
        "longitude": lng,
        "hourly": "wind_gusts_10m,precipitation,snowfall",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
        "forecast_days": forecast_days,
        "timezone": "UTC",
    }
    response = requests.get(OPEN_METEO_URL, params=params, timeout=timeout)
    response.raise_for_status()
    return response.json()


class Classification(NamedTuple):
    is_risky: bool
    event_type: str
    severity: Severity


def classify(raw_payload: dict[str, Any]) -> Classification:
    """Classify a single reading, shaped like Open-Meteo's `current` block
    (`{"current": {"wind_gusts_10m": ..., "precipitation": ..., "snowfall": ...}}`).

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


_SEVERITY_RANK = {Severity.LOW: 0, Severity.MEDIUM: 1, Severity.HIGH: 2}


class RiskyWindow(NamedTuple):
    classification: Classification
    start: datetime
    end: datetime
    peak_reading: dict[str, float]


def find_risky_window(raw_forecast: dict[str, Any]) -> RiskyWindow | None:
    """Scan an hourly forecast and, if any hour clears the risk thresholds,
    return the window spanning every risky hour (not just the worst one) —
    that's the period a guest's stay actually needs to overlap to be
    affected. MVP-simple: one window per location, built from the single
    worst hour's classification, even if the risky hours aren't perfectly
    contiguous. Returns None if nothing in the forecast is risky.
    """
    hourly = raw_forecast.get("hourly", {})
    times = hourly.get("time", [])
    gusts = hourly.get("wind_gusts_10m", [])
    precipitation = hourly.get("precipitation", [])
    snowfall = hourly.get("snowfall", [])

    risky_hours = []
    for i, time_str in enumerate(times):
        reading = {"current": {
            "wind_gusts_10m": gusts[i],
            "precipitation": precipitation[i],
            "snowfall": snowfall[i],
        }}
        classification = classify(reading)
        if classification.is_risky:
            risky_hours.append((time_str, classification, reading["current"]))

    if not risky_hours:
        return None

    worst_time, worst_classification, worst_reading = max(
        risky_hours, key=lambda hour: _SEVERITY_RANK[hour[1].severity]
    )
    start = datetime.fromisoformat(risky_hours[0][0]).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(risky_hours[-1][0]).replace(tzinfo=timezone.utc) + timedelta(hours=1)

    return RiskyWindow(classification=worst_classification, start=start, end=end, peak_reading=worst_reading)


def build_disruption_event(
    location: Location,
    classification: Classification,
    start: datetime,
    end: datetime,
    raw_reading: dict[str, Any],
    *,
    detected_at: datetime | None = None,
) -> DisruptionEvent:
    """Normalise a classified reading + its risky window into a DisruptionEvent."""
    return DisruptionEvent(
        source=EventSource.WEATHER,
        event_type=classification.event_type,
        severity=classification.severity,
        detected_at=detected_at or datetime.now(timezone.utc),
        affects_window=TimeWindow(start=start, end=end),
        geo=Geo(
            type=GeoType.POINT,
            center=GeoPoint(lat=location.lat, lng=location.lng),
            radius_km=location.radius_km,
        ),
        raw_payload={"location": location.name, **raw_reading},
    )


def detect_events(
    locations: list[Location] | None = None,
    *,
    fetch: Any = fetch_forecast,
) -> list[DisruptionEvent]:
    """Poll every configured location's forecast and return a DisruptionEvent
    for each one with a risky window, using that window's real start/end
    (not a flat guess). Locations with no risky hours in the forecast
    produce nothing.
    """
    events: list[DisruptionEvent] = []
    for location in locations or DEFAULT_LOCATIONS:
        raw_forecast = fetch(location.lat, location.lng)
        window = find_risky_window(raw_forecast)
        if window is not None:
            events.append(
                build_disruption_event(location, window.classification, window.start, window.end, window.peak_reading)
            )
    return events
