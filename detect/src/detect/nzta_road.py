"""Road-closure detection at the "a town got cut off" scale.

A closed suburban street, a lane drop, or a state-highway closure with a
signposted detour affects individual trips, not accommodation demand
across an area -- those produce no event. What this source is looking
for is a full closure of a state highway that is the only sealed way in
or out of a place people stay: SH94 to Milford, SH1 through Kaikōura,
SH6 over Haast, and the like. Those isolate every guest in the town at
once.

Source: Waka Kotahi NZTA Traffic & Travel Data System API. The real
feed shape is aligned inside `fetch_road_events`; classification and
event assembly work off the normalised dicts below.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple

import requests

from src.detect.events import Classification, build_event
from src.detect.models import DisruptionEvent, EventSource, Severity

# NZTA's Traffic Road Event Information System (TREIS). Open data, no key
# or account -- see https://www.nzta.govt.nz/traffic-and-travel-information/use-our-data/about-the-apis/
# WADL: https://trafficnz.info/service/traffic/rest/4?_wadl
# `/events/all/{zoomlevel}` returns every current `roadEvent`; zoom level 1
# is country-wide. The feed has no clean "road number" field, so it is
# parsed out of the description text below.
NZTA_TRAFFIC_EVENTS_URL = "https://trafficnz.info/service/traffic/rest/4/events/all/1"

_SH_NUMBER = re.compile(r"\bSH\s?(\d+[A-Z]?)\b", re.IGNORECASE)
_WKT_COORD = re.compile(r"(-?\d+\.\d+)\s+(-?\d+\.\d+)")

# `alternativeRoute` strings TREIS uses to mean "no detour info", as
# opposed to an actual route description.
_NO_DETOUR_TEXT = {"", "not applicable", "n/a", "none", "no detour", "nil"}

# `impact`/`event_type` values (lower-cased) that mean the carriageway is
# fully closed, not merely congested or hazardous.
FULL_CLOSURE_IMPACTS = {"road closed", "closed", "road closure"}

# When the feed gives no reopening time, the window runs this far forward
# and is refreshed on the next poll.
ROAD_UNKNOWN_END_DAYS = 3

DEFAULT_ROAD_IMPACT_RADIUS_KM = 40.0


class SoleAccessRoute(NamedTuple):
    """A state-highway segment that is the only sealed access to a place
    with guest accommodation. A full closure here isolates the whole
    town, so the event is centred on the town, not the closure point."""

    road_number: str
    keywords: tuple[str, ...]
    town: str
    lat: float
    lng: float
    radius_km: float = DEFAULT_ROAD_IMPACT_RADIUS_KM


SOLE_ACCESS_ROUTES: list[SoleAccessRoute] = [
    SoleAccessRoute("SH94", ("milford", "homer", "te anau downs"), "Milford Sound", -44.6714, 167.9261, 55.0),
    SoleAccessRoute("SH6", ("haast", "gates of haast"), "Haast", -43.8811, 169.0417, 45.0),
    SoleAccessRoute("SH6", ("buller", "hawks crag"), "Buller Gorge", -41.8110, 171.8460, 40.0),
    SoleAccessRoute("SH8", ("lindis",), "Lindis Pass", -44.5560, 169.6300, 40.0),
    SoleAccessRoute("SH1", ("kaikoura", "kaikōura", "hundalee", "mangamaunu"), "Kaikōura", -42.3987, 173.6802, 45.0),
    SoleAccessRoute("SH73", ("arthur", "otira", "porters pass"), "Arthur's Pass", -42.9450, 171.5636, 40.0),
    SoleAccessRoute("SH43", ("forgotten", "whangamomona", "whangamōmona"), "Whangamōmona", -39.1447, 174.7369, 40.0),
]


def _road_number_from_text(*parts: Any) -> str | None:
    for part in parts:
        if not isinstance(part, str):
            continue
        match = _SH_NUMBER.search(part)
        if match:
            return f"SH{match.group(1).upper()}"
    return None


def _first_point(geometry: Any) -> tuple[float | None, float | None]:
    """Pull one representative (lat, lng) out of a TREIS geometry. TREIS
    gives WKT strings like `POINT (lng lat)` or
    `MULTILINESTRING ((lng lat, lng lat))`; also tolerate GeoJSON-style
    coordinate lists."""
    if isinstance(geometry, str):
        match = _WKT_COORD.search(geometry)
        if match:
            return float(match.group(2)), float(match.group(1))
        return None, None
    coords = geometry.get("coordinates") if isinstance(geometry, dict) else geometry
    while isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (list, tuple)):
        coords = coords[0]
    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        try:
            return float(coords[1]), float(coords[0])
        except (TypeError, ValueError):
            return None, None
    return None, None


def _detour_available(alternative: Any) -> bool | None:
    if not isinstance(alternative, str) or alternative.strip().lower() in _NO_DETOUR_TEXT:
        return None
    return True


def _normalise_road_event(raw: dict[str, Any]) -> dict[str, Any]:
    """Map one TREIS `roadevent` onto the shape classify/build expect."""
    description = raw.get("eventDescription") or raw.get("description")
    location_area = raw.get("locationArea") or raw.get("locations")
    journey_name = (raw.get("journey") or {}).get("name") if isinstance(raw.get("journey"), dict) else None
    lat, lng = _first_point(raw.get("geometry"))
    return {
        "event_type": raw.get("eventType"),
        "road_number": journey_name or _road_number_from_text(location_area, description),
        "name": description,
        "location_area": location_area,
        "impact": raw.get("impact") or raw.get("status"),
        "start_date": raw.get("startDate"),
        "end_date": raw.get("endDate"),
        "lat": lat,
        "lng": lng,
        "detour_available": _detour_available(raw.get("alternativeRoute")),
    }


def _iter_raw_events(payload: Any) -> list[dict[str, Any]]:
    """TREIS wraps the list as {"response": {"roadevent": [...]}} (and
    collapses it to a single object when there is only one). Tolerate a
    few other nestings too."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        node = payload.get("response", payload)
        for key in ("roadevent", "roadEvent", "roadEvents", "events", "features", "data"):
            value = node.get(key) if isinstance(node, dict) else None
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                return [value]
    return []


def fetch_road_events(*, api_key: str | None = None, timeout: float = 10.0) -> list[dict[str, Any]]:
    """Return current NZ road-network events from TREIS, normalised to
    `{event_type, road_number, name, location_area, impact, start_date,
    end_date, lat, lng, detour_available}`.

    `api_key` is unused (TREIS is open) and kept only so the call site
    does not special-case this source. The field mapping is best-effort
    against the WADL; verify against a live response and tighten as
    needed.
    """
    _ = api_key
    response = requests.get(
        NZTA_TRAFFIC_EVENTS_URL, headers={"Accept": "application/json"}, timeout=timeout
    )
    response.raise_for_status()
    raw_events = _iter_raw_events(response.json())
    return [_normalise_road_event(raw.get("properties", raw)) for raw in raw_events]


def _parse_dt(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _match_sole_access_route(road_number: str, text: str) -> SoleAccessRoute | None:
    haystack = text.lower()
    for route in SOLE_ACCESS_ROUTES:
        if route.road_number == road_number and any(kw in haystack for kw in route.keywords):
            return route
    return None


def classify_road_closure(event: dict[str, Any]) -> Classification | None:
    """Decide whether one road event is a town-scale closure. Returns
    None for anything that is not a full state-highway closure that
    either has no detour or sits on a sole-access route."""
    impact = (event.get("impact") or event.get("event_type") or "").strip().lower()
    road_number = (event.get("road_number") or "").strip().upper()

    if impact not in FULL_CLOSURE_IMPACTS:
        return None
    if not road_number.startswith("SH"):
        return None

    detour_available = event.get("detour_available")
    sole_access = _match_sole_access_route(
        road_number, f"{event.get('location_area') or ''} {event.get('name') or ''}"
    )
    if detour_available is not False and sole_access is None:
        return None

    open_ended = _parse_dt(event.get("end_date")) is None
    if sole_access is not None or (detour_available is False and open_ended):
        severity = Severity.HIGH
    else:
        severity = Severity.MEDIUM
    return Classification(True, "road_closure", severity)


def build_road_event(
    event: dict[str, Any],
    classification: Classification,
    *,
    now: datetime | None = None,
    detected_at: datetime | None = None,
) -> DisruptionEvent | None:
    """Normalise one classified road event into a DisruptionEvent, or None
    if it cannot be placed on the map (no sole-access match and no usable
    coordinates)."""
    now_value = now or datetime.now(timezone.utc)
    road_number = (event.get("road_number") or "").strip().upper()
    sole_access = _match_sole_access_route(
        road_number, f"{event.get('location_area') or ''} {event.get('name') or ''}"
    )

    if sole_access is not None:
        center_lat, center_lng, radius_km = sole_access.lat, sole_access.lng, sole_access.radius_km
    else:
        try:
            center_lat = float(event["lat"])
            center_lng = float(event["lng"])
        except (KeyError, TypeError, ValueError):
            return None
        radius_km = DEFAULT_ROAD_IMPACT_RADIUS_KM

    window_start = _parse_dt(event.get("start_date")) or now_value
    window_end = _parse_dt(event.get("end_date")) or now_value + timedelta(days=ROAD_UNKNOWN_END_DAYS)
    if window_start >= window_end:
        window_start, window_end = now_value, now_value + timedelta(days=ROAD_UNKNOWN_END_DAYS)

    return build_event(
        source=EventSource.ROAD,
        event_type=classification.event_type,
        severity=classification.severity,
        window_start=window_start,
        window_end=window_end,
        center_lat=center_lat,
        center_lng=center_lng,
        radius_km=radius_km,
        raw_payload={
            "source_api": "nzta/traffic-events",
            "road_number": road_number,
            "location_area": event.get("location_area"),
            "impact": event.get("impact") or event.get("event_type"),
            "detour_available": event.get("detour_available"),
            "sole_access_route": sole_access.town if sole_access else None,
        },
        detected_at=detected_at or now_value,
    )


def detect_road_events(
    *, fetch: Any = fetch_road_events, now: datetime | None = None
) -> list[DisruptionEvent]:
    """Poll the NZTA feed and return a DisruptionEvent for each full
    state-highway closure that isolates a town."""
    now_value = now or datetime.now(timezone.utc)
    events: list[DisruptionEvent] = []
    for event in fetch():
        classification = classify_road_closure(event)
        if classification is None:
            continue
        built = build_road_event(event, classification, now=now_value)
        if built is not None:
            events.append(built)
    return events
