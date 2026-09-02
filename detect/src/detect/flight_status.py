"""Flight-disruption detection at airport-aggregate scale only.

One passenger's cancelled flight is explicitly out of scope -- and the
booking data carries no flight numbers anyway. This source asks a single
question per airport: "is a large share of departures in the next few
hours cancelled?" When yes, it emits one DisruptionEvent centred on the
airport with a radius covering the city where stranded passengers need a
room. A handful of cancellations never produces an event.

Data source: for local dev / demo this polls the AeroDataBox airport
FIDS endpoint via RapidAPI (a free tier exists; key in `RAPIDAPI_KEY`).
Production is intended to move to OAG (the project provisions an
`oag/api-key` secret) -- only `fetch_flight_status` changes; everything
downstream consumes the normalised `{flight_iata, scheduled_time,
status}` dicts, so classification and event assembly stay
provider-agnostic and testable without the network.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple
from zoneinfo import ZoneInfo

import requests

from src.detect.events import Classification, build_event
from src.detect.models import DisruptionEvent, EventSource, Severity

# AeroDataBox airport FIDS (flight information display) endpoint. The
# time range in the path is airport-*local* time, "YYYY-MM-DDTHH:MM", and
# the window may not exceed 12 hours.
AERODATABOX_HOST = "aerodatabox.p.rapidapi.com"
AERODATABOX_AIRPORT_FLIGHTS_URL = "https://aerodatabox.p.rapidapi.com/flights/airports/iata"

# Every airport we monitor is in this one zone (Chatham Islands would
# not be, but no NZ mainland airport differs).
NZ_AIRPORT_TZ = ZoneInfo("Pacific/Auckland")

# How far ahead to look when judging whether an airport is disrupted.
# Also the max window AeroDataBox's FIDS endpoint allows.
FLIGHT_LOOKAHEAD_HOURS = 12

# Regional-scale gate: this many cancellations in the window, OR this
# fraction of a large-enough schedule.
FLIGHT_CANCEL_COUNT_THRESHOLD = 10
FLIGHT_MIN_SCHEDULE_FOR_RATIO = 8
FLIGHT_CANCEL_FRACTION_THRESHOLD = 0.30

# Above these it is a near-total shutdown, not just a bad afternoon.
FLIGHT_HIGH_COUNT = 30
FLIGHT_HIGH_FRACTION = 0.60

# Providers spell it differently ("Cancelled" / "Canceled" /
# "CanceledUncertain"); match on the stem.
CANCELLED_STATUS_STEM = "cancel"

DEFAULT_AIRPORT_IMPACT_RADIUS_KM = 40.0


class Airport(NamedTuple):
    iata: str
    lat: float
    lng: float
    impact_radius_km: float = DEFAULT_AIRPORT_IMPACT_RADIUS_KM


# NZ airports with enough traffic and nearby accommodation for a mass
# cancellation to strand guests. Smaller-metro airports get a tighter
# radius.
MONITORED_AIRPORTS: list[Airport] = [
    Airport("AKL", -37.0082, 174.7850),
    Airport("WLG", -41.3272, 174.8053),
    Airport("CHC", -43.4894, 172.5322),
    Airport("ZQN", -45.0211, 168.7392, 30.0),
    Airport("DUD", -45.9281, 170.1983, 30.0),
    Airport("NSN", -41.2983, 173.2211, 25.0),
]


class AirportDisruption(NamedTuple):
    classification: Classification
    window_start: datetime
    window_end: datetime
    scheduled_count: int
    cancelled_count: int
    cancelled_fraction: float
    sample_cancelled_flights: list[str]


def aerodatabox_departures(
    airport_iata: str,
    *,
    lookahead_hours: int = FLIGHT_LOOKAHEAD_HOURS,
    api_key: str | None = None,
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Raw AeroDataBox FIDS response for one airport's upcoming
    departures. Kept separate so a caller (or a debug run) can inspect
    the untouched JSON."""
    key = api_key or os.environ.get("RAPIDAPI_KEY")
    if not key:
        raise RuntimeError("RAPIDAPI_KEY is not set (AeroDataBox / RapidAPI key)")

    start_local = datetime.now(NZ_AIRPORT_TZ)
    end_local = start_local + timedelta(hours=min(lookahead_hours, FLIGHT_LOOKAHEAD_HOURS))
    fmt = "%Y-%m-%dT%H:%M"
    url = f"{AERODATABOX_AIRPORT_FLIGHTS_URL}/{airport_iata}/{start_local.strftime(fmt)}/{end_local.strftime(fmt)}"

    params = {
        "withLeg": "false",
        "direction": "Departure",
        "withCancelled": "true",
        "withCodeshared": "false",
        "withCargo": "false",
        "withPrivate": "false",
        "withLocation": "false",
    }
    headers = {"x-rapidapi-host": AERODATABOX_HOST, "x-rapidapi-key": key}

    # The RapidAPI free tier throttles hard; polling several airports in a
    # row trips 429. Back off and retry a couple of times before giving up.
    for attempt in range(3):
        response = requests.get(url, params=params, headers=headers, timeout=timeout)
        if response.status_code == 429 and attempt < 2:
            time.sleep(2.0 * (attempt + 1))
            continue
        response.raise_for_status()
        return response.json()
    response.raise_for_status()
    return response.json()


def _scheduled_utc(movement: dict[str, Any]) -> datetime | None:
    stamp = (movement.get("scheduledTime") or {}).get("utc")
    if not isinstance(stamp, str):
        return None
    try:
        return datetime.fromisoformat(stamp.strip().replace(" ", "T").replace("Z", "+00:00"))
    except ValueError:
        return None


def fetch_flight_status(
    airport_iata: str,
    *,
    lookahead_hours: int = FLIGHT_LOOKAHEAD_HOURS,
    api_key: str | None = None,
    timeout: float = 15.0,
) -> list[dict[str, Any]]:
    """Return the next `lookahead_hours` of departures for an airport,
    normalised to `{flight_iata, scheduled_time (aware UTC), status}`.

    Wraps `aerodatabox_departures`. Verify the field names against a live
    response and tighten if AeroDataBox shifts its schema.
    """
    payload = aerodatabox_departures(
        airport_iata, lookahead_hours=lookahead_hours, api_key=api_key, timeout=timeout
    )
    raw = payload.get("departures") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []

    flights: list[dict[str, Any]] = []
    for item in raw:
        scheduled_time = _scheduled_utc(item.get("movement") or {})
        if scheduled_time is None:
            continue
        flights.append(
            {
                "flight_iata": (item.get("number") or "").replace(" ", ""),
                "scheduled_time": scheduled_time,
                "status": (item.get("status") or "").strip().lower(),
            }
        )
    return flights


def classify_airport_disruption(
    flights: list[dict[str, Any]],
    *,
    now: datetime,
    lookahead_hours: int = FLIGHT_LOOKAHEAD_HOURS,
) -> AirportDisruption | None:
    """Judge one airport's next `lookahead_hours`. Returns None unless the
    cancellation count or share clears the regional-scale gate."""
    horizon = now + timedelta(hours=lookahead_hours)
    scheduled = [
        f for f in flights if f.get("scheduled_time") and now <= f["scheduled_time"] <= horizon
    ]
    cancelled = [f for f in scheduled if CANCELLED_STATUS_STEM in (f.get("status") or "").lower()]

    scheduled_count = len(scheduled)
    cancelled_count = len(cancelled)
    fraction = cancelled_count / scheduled_count if scheduled_count else 0.0

    clears_count = cancelled_count >= FLIGHT_CANCEL_COUNT_THRESHOLD
    clears_fraction = (
        scheduled_count >= FLIGHT_MIN_SCHEDULE_FOR_RATIO
        and fraction >= FLIGHT_CANCEL_FRACTION_THRESHOLD
    )
    if not (clears_count or clears_fraction):
        return None

    severity = (
        Severity.HIGH
        if cancelled_count >= FLIGHT_HIGH_COUNT or fraction >= FLIGHT_HIGH_FRACTION
        else Severity.MEDIUM
    )

    cancel_times = [f["scheduled_time"] for f in cancelled]
    window_start = max(now, min(cancel_times))
    window_end = min(horizon, max(cancel_times))
    if window_start >= window_end:
        window_start, window_end = now, horizon

    return AirportDisruption(
        classification=Classification(True, "mass_flight_cancellation", severity),
        window_start=window_start,
        window_end=window_end,
        scheduled_count=scheduled_count,
        cancelled_count=cancelled_count,
        cancelled_fraction=round(fraction, 3),
        sample_cancelled_flights=[f.get("flight_iata") for f in cancelled[:10] if f.get("flight_iata")],
    )


def build_flight_event(
    airport: Airport,
    disruption: AirportDisruption,
    *,
    detected_at: datetime | None = None,
) -> DisruptionEvent:
    """Normalise one airport's disruption into a DisruptionEvent."""
    return build_event(
        source=EventSource.FLIGHT,
        event_type=disruption.classification.event_type,
        severity=disruption.classification.severity,
        window_start=disruption.window_start,
        window_end=disruption.window_end,
        center_lat=airport.lat,
        center_lng=airport.lng,
        radius_km=airport.impact_radius_km,
        raw_payload={
            "source_api": "aerodatabox/airport-fids",
            "airport_iata": airport.iata,
            "scheduled_count": disruption.scheduled_count,
            "cancelled_count": disruption.cancelled_count,
            "cancelled_fraction": disruption.cancelled_fraction,
            "sample_cancelled_flights": disruption.sample_cancelled_flights,
        },
        detected_at=detected_at,
    )


def detect_flight_events(
    *,
    fetch: Any = fetch_flight_status,
    now: datetime | None = None,
    api_key: str | None = None,
    lookahead_hours: int = FLIGHT_LOOKAHEAD_HOURS,
) -> list[DisruptionEvent]:
    """Poll every monitored airport and return a DisruptionEvent for each
    one whose cancellations clear the regional-scale gate."""
    now_value = now or datetime.now(timezone.utc)
    events: list[DisruptionEvent] = []
    for airport in MONITORED_AIRPORTS:
        flights = fetch(airport.iata, lookahead_hours=lookahead_hours, api_key=api_key)
        disruption = classify_airport_disruption(
            flights, now=now_value, lookahead_hours=lookahead_hours
        )
        if disruption is not None:
            events.append(build_flight_event(airport, disruption, detected_at=now_value))
    return events
