from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.detect.models import DisruptionEvent, EventSource, Geo, GeoPoint, GeoType, Severity, TimeWindow
from src.identify.geo import haversine_km
from src.identify.matcher import filter_by_distance, find_affected_bookings

SEED_DATA_DIR = Path(__file__).resolve().parent.parent / "seed_data"

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
                "booking_id": "booking-0001",
                "property_id": "prop-qtn-1",
                "guest_id": "guest-001",
                "check_in": date(2026, 8, 25),
                "check_out": date(2026, 8, 28),
                "property_name": "Queenstown Lakefront Lodge",
                "lat": -45.0312,
                "lng": 168.6626,
            },
            {
                "booking_id": "booking-0004",
                "property_id": "prop-akl-1",
                "guest_id": "guest-004",
                "check_in": date(2026, 8, 25),
                "check_out": date(2026, 8, 27),
                "property_name": "Auckland CBD Apartment",
                "lat": -36.8485,
                "lng": 174.7633,
            },
        ]
        conn, cursor = self._mock_conn(rows)

        affected = find_affected_bookings(_storm_event(), conn)

        assert [b["booking_id"] for b in affected] == ["booking-0001"]
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
    """Optional integration fixture: only runs if a local Postgres (e.g.
    from `docker compose up`) is reachable. Skips otherwise so the default
    test run never depends on real infrastructure.
    """
    from src.identify.db import apply_sql_file, get_connection

    try:
        conn = get_connection()
    except Exception as exc:
        pytest.skip(f"no local Postgres available: {exc}")
        return

    apply_sql_file(conn, SEED_DATA_DIR / "schema.sql")
    with conn.cursor() as cur:
        cur.execute("TRUNCATE bookings, properties CASCADE")
    apply_sql_file(conn, SEED_DATA_DIR / "seed.sql")

    yield conn
    conn.close()


class TestFindAffectedBookingsIntegration:
    def test_seed_data_matches_expected_bookings(self, live_pg_conn):
        affected = find_affected_bookings(_storm_event(), live_pg_conn)
        ids = {b["booking_id"] for b in affected}
        assert ids == {"booking-0001", "booking-0002"}
