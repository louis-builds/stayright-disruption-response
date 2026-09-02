from datetime import datetime, timezone

from src.detect.models import EventSource, Severity
from src.detect.nzta_road import (
    ROAD_UNKNOWN_END_DAYS,
    classify_road_closure,
    detect_road_events,
)

NOW = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _event(**overrides):
    base = {
        "event_type": "Road Closed",
        "road_number": "SH6",
        "name": "Haast Pass",
        "location_area": "West Coast",
        "impact": "Road Closed",
        "start_date": None,
        "end_date": None,
        "lat": -44.09,
        "lng": 169.35,
        "detour_available": False,
    }
    base.update(overrides)
    return base


class TestClassifyRoadClosure:
    def test_congestion_is_not_a_closure(self):
        assert classify_road_closure(_event(impact="Congestion", event_type="Congestion")) is None

    def test_local_road_closure_is_ignored(self):
        assert classify_road_closure(_event(road_number="Tinakori Road", name="Wellington")) is None

    def test_state_highway_closed_with_a_detour_and_no_sole_access_is_ignored(self):
        event = _event(
            road_number="SH2", name="Somewhere ordinary", location_area="Bay of Plenty",
            detour_available=True,
        )
        assert classify_road_closure(event) is None

    def test_state_highway_closed_with_no_detour_fires(self):
        event = _event(road_number="SH2", name="Somewhere ordinary", location_area="Bay of Plenty",
                       detour_available=False, end_date="2026-09-02T00:00:00Z")
        result = classify_road_closure(event)
        assert result is not None
        assert result.event_type == "road_closure"
        assert result.severity is Severity.MEDIUM

    def test_sole_access_route_closure_is_high(self):
        result = classify_road_closure(_event(road_number="SH94", name="Homer Tunnel", location_area="Milford"))
        assert result is not None
        assert result.severity is Severity.HIGH

    def test_no_detour_and_open_ended_is_high(self):
        result = classify_road_closure(_event(road_number="SH2", name="ordinary", location_area="BoP",
                                              detour_available=False, end_date=None))
        assert result.severity is Severity.HIGH


class TestDetectRoadEvents:
    def test_sole_access_closure_produces_one_event_centred_on_the_town(self):
        events = detect_road_events(
            fetch=lambda: [_event(road_number="SH94", name="Homer Tunnel", location_area="Milford Sound Road")],
            now=NOW,
        )

        assert len(events) == 1
        event = events[0]
        assert event.source is EventSource.ROAD
        assert event.event_type == "road_closure"
        assert event.severity is Severity.HIGH
        # Centred on Milford, not on the raw closure coordinates.
        assert event.geo.center.lat != -44.09
        assert event.raw_payload["sole_access_route"] == "Milford Sound"
        assert event.raw_payload["road_number"] == "SH94"
        assert "wind_gusts_10m" not in event.raw_payload

    def test_open_ended_window_uses_the_fallback_horizon(self):
        events = detect_road_events(
            fetch=lambda: [_event(road_number="SH94", name="Homer", location_area="Milford", end_date=None)],
            now=NOW,
        )
        window_days = (events[0].affects_window.end - events[0].affects_window.start).days
        assert window_days == ROAD_UNKNOWN_END_DAYS

    def test_mixed_feed_only_keeps_the_regional_closures(self):
        feed = [
            _event(impact="Congestion", event_type="Congestion"),
            _event(road_number="Queen Street", name="Auckland CBD"),
            _event(road_number="SH1", name="Hundalee", location_area="Kaikoura"),
        ]
        events = detect_road_events(fetch=lambda: feed, now=NOW)
        assert len(events) == 1
        assert events[0].raw_payload["road_number"] == "SH1"

    def test_closure_without_coordinates_or_sole_access_is_skipped(self):
        event = _event(road_number="SH2", name="ordinary", location_area="BoP", lat=None, lng=None)
        events = detect_road_events(fetch=lambda: [event], now=NOW)
        assert events == []

    def test_no_network_when_fetch_is_stubbed(self):
        assert detect_road_events(fetch=lambda: [], now=NOW) == []
