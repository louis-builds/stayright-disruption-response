from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from src.detect.events import Classification, build_event
from src.detect.models import EventSource, GeoType, Severity


def _kwargs(**overrides):
    now = datetime.now(timezone.utc)
    kwargs = dict(
        source=EventSource.VOLCANO,
        event_type="volcanic_eruption",
        severity=Severity.HIGH,
        window_start=now,
        window_end=now + timedelta(days=7),
        center_lat=-39.28,
        center_lng=175.57,
        radius_km=90.0,
        raw_payload={"source_api": "geonet/volcano/val", "alert_level": 4},
    )
    kwargs.update(overrides)
    return kwargs


class TestBuildEvent:
    def test_assembles_a_valid_event_for_any_source(self):
        event = build_event(**_kwargs())

        assert event.source is EventSource.VOLCANO
        assert event.event_type == "volcanic_eruption"
        assert event.severity is Severity.HIGH
        assert event.geo.type is GeoType.POINT
        assert event.geo.center.lat == -39.28
        assert event.geo.radius_km == 90.0
        assert event.raw_payload["alert_level"] == 4

    def test_detected_at_defaults_to_now(self):
        before = datetime.now(timezone.utc)
        event = build_event(**_kwargs())
        assert before <= event.detected_at <= datetime.now(timezone.utc)

    def test_detected_at_is_honoured_when_passed(self):
        fixed = datetime(2026, 1, 1, tzinfo=timezone.utc)
        event = build_event(**_kwargs(detected_at=fixed))
        assert event.detected_at == fixed

    def test_rejects_window_start_after_end(self):
        now = datetime.now(timezone.utc)
        with pytest.raises(ValidationError):
            build_event(**_kwargs(window_start=now, window_end=now - timedelta(hours=1)))

    def test_classification_namedtuple_carries_verdict(self):
        c = Classification(True, "road_closure", Severity.MEDIUM)
        assert c.is_risky and c.event_type == "road_closure" and c.severity is Severity.MEDIUM
