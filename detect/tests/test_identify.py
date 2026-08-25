from datetime import date, datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from src.detect.models import DisruptionEvent, EventSource, Geo, GeoPoint, GeoType, Severity, TimeWindow
from src.identify.geo import haversine_km
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
    def test_matches_only_non_cancelled_bookings_at_the_targeted_hotel(self, live_pg_conn):
        with live_pg_conn.cursor() as cur:
            cur.execute("SELECT id, lat, lng FROM hotels ORDER BY name LIMIT 1")
            hotel_id, lat, lng = cur.fetchone()
            cur.execute(
                "SELECT count(*) FROM bookings WHERE hotel_id = %(hotel_id)s AND status != 'cancelled'",
                {"hotel_id": hotel_id},
            )
            expected_count = cur.fetchone()[0]

        # Wide window (real hotels' bookings use offsets we don't control
        # here) + a radius that only reaches this one hotel (the seeded
        # hotels are hundreds of km apart) -> every non-cancelled booking
        # at this hotel should match, and nothing from the other hotels.
        now = datetime.now(timezone.utc)
        event = _storm_event(
            geo=Geo(type=GeoType.POINT, center=GeoPoint(lat=lat, lng=lng), radius_km=1),
            affects_window=TimeWindow(start=now - timedelta(days=365), end=now + timedelta(days=365)),
        )

        affected = find_affected_bookings(event, live_pg_conn)

        assert len(affected) == expected_count
        assert all(b["hotel_id"] == hotel_id for b in affected)
