from datetime import datetime, timezone

from src.detect.geonet_volcano import (
    VOLCANO_WINDOW_DAYS,
    MONITORED_VOLCANOES,
    classify_volcano,
    detect_volcano_events,
)
from src.detect.models import EventSource, Severity


def _feature(volcano_id, level, acc="Green", lat=-39.281, lng=175.564):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lng, lat]},
        "properties": {
            "volcanoID": volcano_id,
            "volcanoTitle": volcano_id.title(),
            "level": level,
            "acc": acc,
            "activity": "some activity",
            "hazards": "ashfall",
        },
    }


def _collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


class TestClassifyVolcano:
    def test_level_2_unrest_is_not_regional(self):
        assert classify_volcano(2, "Green").is_risky is False

    def test_level_3_is_a_medium_eruption_event(self):
        result = classify_volcano(3, "Yellow")
        assert result.is_risky is True
        assert result.event_type == "volcanic_eruption"
        assert result.severity is Severity.MEDIUM

    def test_level_5_is_high(self):
        assert classify_volcano(5, "Red").severity is Severity.HIGH

    def test_aviation_red_alone_still_fires_as_unrest(self):
        result = classify_volcano(1, "Red")
        assert result.is_risky is True
        assert result.event_type == "volcanic_unrest"
        assert result.severity is Severity.HIGH

    def test_aviation_orange_alone_is_medium_unrest(self):
        result = classify_volcano(2, "orange")
        assert result.is_risky is True
        assert result.event_type == "volcanic_unrest"
        assert result.severity is Severity.MEDIUM


class TestDetectVolcanoEvents:
    def test_below_threshold_produces_no_event(self):
        events = detect_volcano_events(fetch=lambda: _collection(_feature("ruapehu", 1)))
        assert events == []

    def test_regional_alert_produces_one_event_with_expected_shape(self):
        monitored_id = "ruapehu"
        lat, lng = -39.281, 175.564
        events = detect_volcano_events(
            fetch=lambda: _collection(_feature(monitored_id, 3, "Orange", lat=lat, lng=lng))
        )

        assert len(events) == 1
        event = events[0]
        assert event.source is EventSource.VOLCANO
        assert event.event_type == "volcanic_eruption"
        assert event.severity is Severity.MEDIUM
        assert event.geo.center.lat == lat
        assert event.geo.center.lng == lng
        assert event.geo.radius_km == MONITORED_VOLCANOES[monitored_id].impact_radius_km
        window_days = (event.affects_window.end - event.affects_window.start).days
        assert window_days == VOLCANO_WINDOW_DAYS
        assert event.raw_payload["volcano_id"] == monitored_id
        assert event.raw_payload["alert_level"] == 3
        assert event.raw_payload["aviation_colour_code"] == "Orange"
        assert "wind_gusts_10m" not in event.raw_payload

    def test_unmonitored_volcano_is_ignored(self):
        events = detect_volcano_events(fetch=lambda: _collection(_feature("kermadec-offshore", 4, "Red")))
        assert events == []

    def test_malformed_feature_is_skipped_not_raised(self):
        bad = {"properties": {"volcanoID": "ruapehu", "level": "not-a-number"}}
        no_geom = {"properties": {"volcanoID": "tongariro", "level": 4, "acc": "Red"}}
        events = detect_volcano_events(fetch=lambda: _collection(bad, no_geom))
        assert events == []

    def test_detected_at_and_window_are_timezone_aware(self):
        events = detect_volcano_events(fetch=lambda: _collection(_feature("taupo", 4)))
        event = events[0]
        assert event.detected_at.tzinfo is not None
        assert event.affects_window.start.tzinfo is not None

    def test_no_network_when_fetch_is_stubbed(self):
        events = detect_volcano_events(fetch=lambda: {"features": []})
        assert events == []
