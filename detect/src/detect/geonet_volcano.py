"""Volcano-alert detection: read GeoNet's current Volcanic Alert Level
(VAL) for every NZ volcano and normalise the ones that are disruptive at
a regional scale into a DisruptionEvent.

"Regional scale" is the whole point of this source: a single guest is
never the unit here. A volcano at VAL 3+ ("minor eruption") triggers
DOC track and national-park closures, exclusion zones and ashfall over a
wide area -- it affects every stay near it or none. VAL 2 (unrest, no
eruption) does not close anything on its own, so it produces no event
unless the aviation colour code has been raised to Orange/Red.

Source: GET https://api.geonet.org.nz/volcano/val -- a GeoJSON
FeatureCollection, one feature per volcano, properties `volcanoID`,
`volcanoTitle`, `level` (0-5), `acc` (aviation colour code), `activity`,
`hazards`; geometry is a Point at [lng, lat].
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple

import requests

from src.detect.events import Classification, build_event
from src.detect.models import DisruptionEvent, EventSource, Severity

VOLCANO_VAL_URL = "https://api.geonet.org.nz/volcano/val"
VOLCANO_VAL_ACCEPT = "application/vnd.geo+json;version=2"

# VAL at or above this closes tracks/parks and puts ash over a wide area
# -- inherently a regional disruption. VAL 0-2 does not, on its own.
VOLCANO_MASS_IMPACT_LEVEL = 3

# Aviation colour codes that mean flights in/out of the area are being
# disrupted regardless of the ground-level VAL.
VOLCANO_DISRUPTIVE_AVIATION_CODES = {"orange", "red"}

# Volcanic bulletins carry no "all clear" time, so the window is a fixed
# forward horizon, refreshed every poll -- same honesty limit as a
# weather forecast's range.
VOLCANO_WINDOW_DAYS = 7

DEFAULT_VOLCANO_IMPACT_RADIUS_KM = 60.0


class VolcanoProfile(NamedTuple):
    """A monitored volcano and the radius its ashfall/closure footprint
    realistically reaches guest accommodation."""

    title: str
    impact_radius_km: float = DEFAULT_VOLCANO_IMPACT_RADIUS_KM


# Only volcanoes with guest accommodation in range. GeoNet also reports
# offshore ones (Kermadec, etc.) with no stays nearby -- those are
# ignored. Keyed by GeoNet's volcanoID.
MONITORED_VOLCANOES: dict[str, VolcanoProfile] = {
    "ruapehu": VolcanoProfile("Ruapehu", 90.0),
    "tongariro": VolcanoProfile("Tongariro", 60.0),
    "ngauruhoe": VolcanoProfile("Ngauruhoe", 60.0),
    "taranakimaunga": VolcanoProfile("Taranaki", 70.0),
    "whiteisland": VolcanoProfile("Whakaari/White Island", 60.0),
    "aucklandvolcanicfield": VolcanoProfile("Auckland Volcanic Field", 40.0),
    "okataina": VolcanoProfile("Okataina", 60.0),
    "taupo": VolcanoProfile("Taupō", 90.0),
}


def fetch_volcano_alerts(*, timeout: float = 10.0) -> dict[str, Any]:
    """Call GeoNet for the current VAL of every NZ volcano. Returns the
    raw GeoJSON FeatureCollection."""
    response = requests.get(
        VOLCANO_VAL_URL, headers={"Accept": VOLCANO_VAL_ACCEPT}, timeout=timeout
    )
    response.raise_for_status()
    return response.json()


def classify_volcano(level: int, acc: str | None) -> Classification:
    """Decide whether one volcano's current state is a regional
    disruption. `level` is the VAL (0-5); `acc` is the aviation colour
    code (case-insensitive, may be None)."""
    aviation_disruptive = (acc or "").strip().lower() in VOLCANO_DISRUPTIVE_AVIATION_CODES

    if level >= VOLCANO_MASS_IMPACT_LEVEL:
        severity = Severity.HIGH if level >= 4 or (acc or "").strip().lower() == "red" else Severity.MEDIUM
        return Classification(True, "volcanic_eruption", severity)
    if aviation_disruptive:
        severity = Severity.HIGH if (acc or "").strip().lower() == "red" else Severity.MEDIUM
        return Classification(True, "volcanic_unrest", severity)

    return Classification(False, "none", Severity.LOW)


def _coerce_level(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def build_volcano_event(
    feature: dict[str, Any],
    profile: VolcanoProfile,
    classification: Classification,
    *,
    detected_at: datetime | None = None,
) -> DisruptionEvent:
    """Normalise one GeoNet feature + its classification into a DisruptionEvent."""
    props = feature.get("properties", {})
    lng, lat = feature["geometry"]["coordinates"][:2]
    now = detected_at or datetime.now(timezone.utc)
    return build_event(
        source=EventSource.VOLCANO,
        event_type=classification.event_type,
        severity=classification.severity,
        window_start=now,
        window_end=now + timedelta(days=VOLCANO_WINDOW_DAYS),
        center_lat=lat,
        center_lng=lng,
        radius_km=profile.impact_radius_km,
        raw_payload={
            "source_api": "geonet/volcano/val",
            "volcano_id": props.get("volcanoID"),
            "volcano_title": props.get("volcanoTitle") or profile.title,
            "alert_level": _coerce_level(props.get("level")),
            "aviation_colour_code": props.get("acc"),
            "activity": props.get("activity"),
            "hazards": props.get("hazards"),
        },
        detected_at=now,
    )


def detect_volcano_events(*, fetch: Any = fetch_volcano_alerts) -> list[DisruptionEvent]:
    """Poll GeoNet and return a DisruptionEvent for each monitored volcano
    whose current state is a regional disruption. Unmonitored volcanoes
    and malformed features are skipped."""
    collection = fetch()
    events: list[DisruptionEvent] = []
    for feature in collection.get("features", []):
        props = feature.get("properties", {})
        volcano_id = props.get("volcanoID")
        profile = MONITORED_VOLCANOES.get(volcano_id)
        if profile is None:
            continue

        level = _coerce_level(props.get("level"))
        if level is None:
            continue

        try:
            feature["geometry"]["coordinates"][1]
        except (KeyError, TypeError, IndexError):
            continue

        classification = classify_volcano(level, props.get("acc"))
        if classification.is_risky:
            events.append(build_volcano_event(feature, profile, classification))
    return events
