from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from src.detect.models import (
    DisruptionEvent,
    EventSource,
    Geo,
    GeoPoint,
    GeoType,
    Severity,
    TimeWindow,
)
from src.detect.open_meteo import (
    Location,
    build_disruption_event,
    classify,
    detect_events,
)


def _valid_event_kwargs(**overrides):
    now = datetime.now(timezone.utc)
    kwargs = dict(
        source=EventSource.WEATHER,
        event_type="storm",
        severity=Severity.HIGH,
        detected_at=now,
        affects_window=TimeWindow(start=now, end=now + timedelta(hours=6)),
        geo=Geo(type=GeoType.POINT, center=GeoPoint(lat=-45.03, lng=168.66), radius_km=30),
        raw_payload={"wind_gusts_10m": 90},
    )
    kwargs.update(overrides)
    return kwargs


class TestDisruptionEventSchema:
    def test_valid_event_round_trips(self):
        event = DisruptionEvent(**_valid_event_kwargs())
        assert event.event_id
        payload = event.model_dump(mode="json")
        assert DisruptionEvent(**payload) == event

    def test_event_id_defaults_to_uuid_and_is_unique(self):
        a = DisruptionEvent(**_valid_event_kwargs())
        b = DisruptionEvent(**_valid_event_kwargs())
        assert a.event_id != b.event_id

    def test_rejects_naive_datetimes(self):
        now_naive = datetime.now()
        with pytest.raises(ValidationError):
            DisruptionEvent(**_valid_event_kwargs(detected_at=now_naive))

    def test_rejects_window_start_after_end(self):
        now = datetime.now(timezone.utc)
        with pytest.raises(ValidationError):
            TimeWindow(start=now, end=now - timedelta(hours=1))

    def test_rejects_polygon_geo_as_not_yet_supported(self):
        with pytest.raises(ValidationError):
            Geo(type=GeoType.POLYGON, center=GeoPoint(lat=0, lng=0), radius_km=10)

    def test_rejects_unknown_fields(self):
        with pytest.raises(ValidationError):
            DisruptionEvent(**_valid_event_kwargs(), unexpected_field="oops")

    def test_rejects_negative_radius(self):
        with pytest.raises(ValidationError):
            Geo(type=GeoType.POINT, center=GeoPoint(lat=0, lng=0), radius_km=-1)


class TestClassify:
    def test_calm_weather_is_not_risky(self):
        result = classify({"current": {"wind_gusts_10m": 10, "precipitation": 0, "snowfall": 0}})
        assert result.is_risky is False

    def test_high_wind_gusts_classified_as_storm(self):
        result = classify({"current": {"wind_gusts_10m": 75, "precipitation": 0, "snowfall": 0}})
        assert result.is_risky is True
        assert result.event_type == "storm"
        assert result.severity == Severity.MEDIUM

    def test_extreme_wind_gusts_are_high_severity(self):
        result = classify({"current": {"wind_gusts_10m": 130, "precipitation": 0, "snowfall": 0}})
        assert result.severity == Severity.HIGH

    def test_heavy_precipitation_classified_as_flood(self):
        result = classify({"current": {"wind_gusts_10m": 0, "precipitation": 15, "snowfall": 0}})
        assert result.is_risky is True
        assert result.event_type == "flood"

    def test_snowfall_classified_as_heavy_snow(self):
        result = classify({"current": {"wind_gusts_10m": 0, "precipitation": 0, "snowfall": 8}})
        assert result.is_risky is True
        assert result.event_type == "heavy_snow"

    def test_missing_fields_default_to_calm(self):
        result = classify({"current": {}})
        assert result.is_risky is False


class TestBuildDisruptionEvent:
    def test_builds_valid_event_from_risky_reading(self):
        location = Location("Queenstown", -45.0312, 168.6626)
        raw_payload = {"current": {"wind_gusts_10m": 90}}
        classification = classify({"current": {"wind_gusts_10m": 90, "precipitation": 0, "snowfall": 0}})
        event = build_disruption_event(location, raw_payload, classification)

        assert event.source == EventSource.WEATHER
        assert event.event_type == "storm"
        assert event.geo.center.lat == location.lat
        assert event.geo.center.lng == location.lng
        assert event.raw_payload["location"] == "Queenstown"


class TestDetectEvents:
    def test_only_risky_locations_produce_events(self):
        calm_payload = {"current": {"wind_gusts_10m": 5, "precipitation": 0, "snowfall": 0}}
        storm_payload = {"current": {"wind_gusts_10m": 90, "precipitation": 0, "snowfall": 0}}

        def fake_fetch(lat, lng):
            return storm_payload if lat < -44 else calm_payload

        locations = [
            Location("Queenstown", -45.0312, 168.6626),
            Location("Auckland", -36.8485, 174.7633),
        ]
        events = detect_events(locations, fetch=fake_fetch)

        assert len(events) == 1
        assert events[0].raw_payload["location"] == "Queenstown"

    def test_no_network_call_when_fetch_is_stubbed(self):
        # Ensures the module never hits the real network in tests.
        events = detect_events([Location("X", 0, 0)], fetch=lambda lat, lng: {"current": {}})
        assert events == []
