from datetime import datetime, timedelta, timezone

from src.detect.models import EventSource, Severity
from src.detect.flight_status import (
    FLIGHT_LOOKAHEAD_HOURS,
    MONITORED_AIRPORTS,
    classify_airport_disruption,
    detect_flight_events,
)

NOW = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)


def _flights(cancelled, on_time, *, base=NOW):
    """Build a flat flight list, all scheduled within the next few hours
    so every one falls inside the default lookahead window."""
    out = []
    for i in range(cancelled):
        out.append({"flight_iata": f"NZ{i:03d}", "scheduled_time": base + timedelta(minutes=10 * i + 10), "status": "cancelled"})
    for i in range(on_time):
        out.append({"flight_iata": f"JQ{i:03d}", "scheduled_time": base + timedelta(minutes=7 * i + 5), "status": "on time"})
    return out


class TestClassifyAirportDisruption:
    def test_a_few_cancellations_is_not_regional(self):
        result = classify_airport_disruption(_flights(3, 40), now=NOW, lookahead_hours=FLIGHT_LOOKAHEAD_HOURS)
        assert result is None

    def test_count_threshold_alone_fires(self):
        # 12 cancelled of 42 scheduled: clears the count gate, but the
        # share (~29%) and count are both below the "high" cutoffs.
        result = classify_airport_disruption(_flights(12, 30), now=NOW, lookahead_hours=FLIGHT_LOOKAHEAD_HOURS)
        assert result is not None
        assert result.classification.event_type == "mass_flight_cancellation"
        assert result.classification.severity is Severity.MEDIUM
        assert result.cancelled_count == 12

    def test_fraction_threshold_fires_even_below_the_count(self):
        # 6 cancelled of 15 scheduled = 40%, count is under 10.
        result = classify_airport_disruption(_flights(6, 9), now=NOW, lookahead_hours=FLIGHT_LOOKAHEAD_HOURS)
        assert result is not None
        assert result.cancelled_fraction == 0.4

    def test_small_schedule_does_not_trip_the_fraction_path(self):
        # 3 of 4 is 75% but the schedule is too small to be "regional".
        result = classify_airport_disruption(_flights(3, 1), now=NOW, lookahead_hours=FLIGHT_LOOKAHEAD_HOURS)
        assert result is None

    def test_near_total_shutdown_is_high(self):
        result = classify_airport_disruption(_flights(35, 2), now=NOW, lookahead_hours=FLIGHT_LOOKAHEAD_HOURS)
        assert result.classification.severity is Severity.HIGH

    def test_window_spans_the_cancelled_flights(self):
        result = classify_airport_disruption(_flights(12, 0), now=NOW, lookahead_hours=FLIGHT_LOOKAHEAD_HOURS)
        assert result.window_start >= NOW
        assert result.window_start < result.window_end
        assert result.window_end <= NOW + timedelta(hours=FLIGHT_LOOKAHEAD_HOURS)

    def test_flights_outside_the_lookahead_are_ignored(self):
        far = [
            {"flight_iata": f"NZ{i}", "scheduled_time": NOW + timedelta(hours=48 + i), "status": "cancelled"}
            for i in range(20)
        ]
        assert classify_airport_disruption(far, now=NOW, lookahead_hours=FLIGHT_LOOKAHEAD_HOURS) is None

    def test_empty_list_is_none(self):
        assert classify_airport_disruption([], now=NOW) is None


class TestDetectFlightEvents:
    def test_one_event_per_disrupted_airport_with_expected_shape(self):
        target = MONITORED_AIRPORTS[0]

        def fake_fetch(airport_iata, *, lookahead_hours, api_key):
            return _flights(15, 3) if airport_iata == target.iata else _flights(1, 30)

        events = detect_flight_events(fetch=fake_fetch, now=NOW)

        assert len(events) == 1
        event = events[0]
        assert event.source is EventSource.FLIGHT
        assert event.geo.center.lat == target.lat
        assert event.geo.radius_km == target.impact_radius_km
        assert event.raw_payload["airport_iata"] == target.iata
        assert event.raw_payload["cancelled_count"] == 15
        assert event.raw_payload["source_api"] == "aerodatabox/airport-fids"
        assert event.detected_at == NOW

    def test_calm_network_produces_nothing(self):
        events = detect_flight_events(
            fetch=lambda airport_iata, *, lookahead_hours, api_key: _flights(0, 20), now=NOW
        )
        assert events == []

    def test_no_network_when_fetch_is_stubbed(self):
        events = detect_flight_events(
            fetch=lambda airport_iata, *, lookahead_hours, api_key: [], now=NOW
        )
        assert events == []
