import json
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from src.detect.models import DisruptionEvent, EventSource, Geo, GeoPoint, GeoType, Severity, TimeWindow
from src.identify.geo import haversine_km
from src.identify.handoff import build_handoff_payloads, write_handoff_messages
from src.identify.matcher import filter_by_distance, find_affected_bookings

QUEENSTOWN = GeoPoint(lat=-45.0312, lng=168.6626)


def _storm_event(**overrides) -> DisruptionEvent:
    kwargs = dict(
        source=EventSource.WEATHER,
        event_type="storm",
        severity=Severity.HIGH,
        detected_at=datetime(2026, 8, 25, tzinfo=timezone.utc),
        affects_window=TimeWindow(
            start=datetime(2026, 8, 25, tzinfo=timezone.utc),
            end=datetime(2026, 8, 26, tzinfo=timezone.utc),
        ),
        geo=Geo(type=GeoType.POINT, center=QUEENSTOWN, radius_km=30),
        raw_payload={},
    )
    kwargs.update(overrides)
    return DisruptionEvent(**kwargs)


class TestHaversine:
    def test_same_point_is_zero_distance(self):
        assert haversine_km(-45.0312, 168.6626, -45.0312, 168.6626) == pytest.approx(0.0, abs=1e-6)

    def test_queenstown_to_auckland_is_roughly_correct(self):
        # Known great-circle distance is ~1040km; allow some slack.
        distance = haversine_km(-45.0312, 168.6626, -36.8485, 174.7633)
        assert 950 < distance < 1150


class TestFilterByDistance:
    CANDIDATES = [
        {"booking_id": "b1", "lat": -45.0312, "lng": 168.6626},  # 0km
        {"booking_id": "b2", "lat": -45.05, "lng": 168.70},  # ~5km
        {"booking_id": "b3", "lat": -36.8485, "lng": 174.7633},  # ~860km
    ]

    def test_keeps_only_bookings_within_radius(self):
        result = filter_by_distance(self.CANDIDATES, -45.0312, 168.6626, radius_km=30)
        ids = {c["booking_id"] for c in result}
        assert ids == {"b1", "b2"}

    def test_empty_candidates_returns_empty(self):
        assert filter_by_distance([], -45.0312, 168.6626, radius_km=30) == []


class TestBuildHandoffPayloads:
    def test_disruption_event_message_shape(self):
        event = _storm_event(
            raw_payload={"location": "Queenstown", "wind_gusts_10m": 150, "precipitation": 0, "snowfall": 0}
        )

        disruption_event_message, customer_messages = build_handoff_payloads(event, [])

        de = disruption_event_message["disruption_event"]
        assert de["id"] == event.event_id
        assert de["type"] == "weather"
        assert de["event_subtype"] == "storm"
        assert de["severity"] == "high"
        assert de["geo"] == {"lat": QUEENSTOWN.lat, "lng": QUEENSTOWN.lng, "radius_km": 30}
        # raw_signal passes the source's own payload through, minus the
        # weather-only "location" label.
        assert de["raw_signal"] == {"wind_gusts_10m": 150, "precipitation": 0, "snowfall": 0}
        assert customer_messages == []

    def test_raw_signal_passes_through_non_weather_source_fields(self):
        event = _storm_event(
            source=EventSource.VOLCANO,
            event_type="volcanic_eruption",
            raw_payload={
                "source_api": "geonet/volcano/val",
                "volcano_id": "ruapehu",
                "alert_level": 3,
                "aviation_colour_code": "Orange",
            },
        )

        disruption_event_message, _ = build_handoff_payloads(event, [])

        de = disruption_event_message["disruption_event"]
        assert de["type"] == "volcano"
        assert de["event_subtype"] == "volcanic_eruption"
        assert de["raw_signal"] == {
            "source_api": "geonet/volcano/val",
            "volcano_id": "ruapehu",
            "alert_level": 3,
            "aviation_colour_code": "Orange",
        }
        assert "wind_gusts_kmh" not in de["raw_signal"]

    def test_affected_customer_messages_reference_event_and_stringify_uuids(self):
        event = _storm_event()
        booking = {
            "guest_id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
            "booking_id": uuid.UUID("22222222-2222-2222-2222-222222222222"),
        }

        _, customer_messages = build_handoff_payloads(event, [booking])

        assert customer_messages == [{
            "disruption_event_id": event.event_id,
            "guest_id": "11111111-1111-1111-1111-111111111111",
            "booking_id": "22222222-2222-2222-2222-222222222222",
        }]

    def test_one_customer_message_per_affected_booking(self):
        event = _storm_event()
        bookings = [
            {"guest_id": "g1", "booking_id": "b1"},
            {"guest_id": "g2", "booking_id": "b2"},
        ]

        _, customer_messages = build_handoff_payloads(event, bookings)

        assert [m["booking_id"] for m in customer_messages] == ["b1", "b2"]
        assert all(m["disruption_event_id"] == event.event_id for m in customer_messages)


class TestWriteHandoffMessages:
    def test_writes_one_json_line_per_message_and_creates_parent_dirs(self, tmp_path):
        output_path = tmp_path / "nested" / "handoff.jsonl"

        write_handoff_messages(output_path, [{"a": 1}, {"b": 2}])

        lines = output_path.read_text(encoding="utf-8").splitlines()
        assert [json.loads(line) for line in lines] == [{"a": 1}, {"b": 2}]

    def test_a_later_write_replaces_earlier_content_entirely(self, tmp_path):
        output_path = tmp_path / "handoff.jsonl"

        write_handoff_messages(output_path, [{"a": 1}, {"b": 2}])
        write_handoff_messages(output_path, [{"c": 3}])

        lines = output_path.read_text(encoding="utf-8").splitlines()
        assert [json.loads(line) for line in lines] == [{"c": 3}]


class TestFindAffectedBookings:
    """Uses a mocked connection so this never touches a real database."""

    def _mock_conn(self, rows: list[dict]):
        columns = list(rows[0].keys()) if rows else []
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.description = [MagicMock(name=col) for col in columns]
        for col_mock, name in zip(cursor.description, columns):
            col_mock.name = name
        cursor.fetchall.return_value = [tuple(row[col] for col in columns) for row in rows]

        conn = MagicMock()
        conn.cursor.return_value = cursor
        return conn, cursor

    def test_queries_by_window_and_filters_by_distance(self):
        rows = [
            {
                "booking_id": "11111111-0000-0000-0000-000000000001",
                "hotel_id": "22222222-0000-0000-0000-000000000001",
                "guest_id": "33333333-0000-0000-0000-000000000001",
                "check_in": date(2026, 8, 25),
                "check_out": date(2026, 8, 28),
                "hotel_name": "Queenstown Lakeview Hotel",
                "lat": -45.0312,
                "lng": 168.6626,
            },
            {
                "booking_id": "11111111-0000-0000-0000-000000000002",
                "hotel_id": "22222222-0000-0000-0000-000000000002",
                "guest_id": "33333333-0000-0000-0000-000000000002",
                "check_in": date(2026, 8, 25),
                "check_out": date(2026, 8, 27),
                "hotel_name": "Auckland Harbour Hotel",
                "lat": -36.8485,
                "lng": 174.7633,
            },
        ]
        conn, cursor = self._mock_conn(rows)

        affected = find_affected_bookings(_storm_event(), conn)

        assert [b["booking_id"] for b in affected] == ["11111111-0000-0000-0000-000000000001"]
        args, kwargs = cursor.execute.call_args
        params = args[1]
        assert params["window_start"] == date(2026, 8, 25)
        assert params["window_end"] == date(2026, 8, 26)

    def test_no_candidates_returns_empty(self):
        conn, _ = self._mock_conn([])
        assert find_affected_bookings(_storm_event(), conn) == []

    def test_polygon_geo_is_not_implemented(self):
        with pytest.raises(Exception):
            Geo(type=GeoType.POLYGON, center=QUEENSTOWN, radius_km=30)


@pytest.fixture
def live_pg_conn():
    """Optional integration fixture: only runs if the shared Postgres
    (`travel_disruption`, the same database the C# backend uses) is
    reachable and already seeded. Skips otherwise so the default test run
    never depends on real infrastructure.
    """
    from src.identify.db import get_connection

    try:
        conn = get_connection()
    except Exception as exc:
        pytest.skip(f"no local Postgres available: {exc}")
        return

    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM hotels")
        if cur.fetchone()[0] == 0:
            pytest.skip("travel_disruption has no hotels yet -- run the C# backend once (dotnet run) to seed it")

    yield conn
    conn.close()


class TestFindAffectedBookingsIntegration:
    def test_matches_only_non_cancelled_bookings_within_radius(self, live_pg_conn):
        with live_pg_conn.cursor() as cur:
            cur.execute("SELECT id, lat, lng FROM hotels ORDER BY name LIMIT 1")
            hotel_id, lat, lng = cur.fetchone()

            # Some seed hotels share exact coordinates (e.g. a test hotel
            # added at the same spot as a real one), so a tight radius can
            # still cover more than one hotel_id -- compute the actual set
            # instead of assuming the picked hotel is alone within 1km.
            cur.execute("SELECT id, lat, lng FROM hotels")
            nearby_hotel_ids = [
                row[0] for row in cur.fetchall() if haversine_km(lat, lng, row[1], row[2]) <= 1
            ]
            cur.execute(
                "SELECT count(*) FROM bookings WHERE hotel_id = ANY(%(hotel_ids)s) AND status != 'cancelled'",
                {"hotel_ids": nearby_hotel_ids},
            )
            expected_count = cur.fetchone()[0]

        # Wide window (real hotels' bookings use offsets we don't control
        # here) + a radius of 1km -> every non-cancelled booking at a hotel
        # within that radius should match, and nothing further away.
        now = datetime.now(timezone.utc)
        event = _storm_event(
            geo=Geo(type=GeoType.POINT, center=GeoPoint(lat=lat, lng=lng), radius_km=1),
            affects_window=TimeWindow(start=now - timedelta(days=365), end=now + timedelta(days=365)),
        )

        affected = find_affected_bookings(event, live_pg_conn)

        assert len(affected) == expected_count
        assert all(b["hotel_id"] in nearby_hotel_ids for b in affected)
