"""identify_bookings 节点：复用 src/identify 的 matcher，脱库测（mock 连接）。

镜像 tests/test_identify.py::TestFindAffectedBookings 的 _mock_conn 做法。
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from unittest.mock import MagicMock

from agent.langgraph_framework import identify_bookings
from src.detect.models import DisruptionEvent

# Queenstown Lakeview Hotel 附近；storm 事件半径 30km
_EVENT = DisruptionEvent(
    source="weather",
    event_type="storm",
    severity="high",
    detected_at=datetime(2026, 8, 9, tzinfo=timezone.utc),
    affects_window={
        "start": datetime(2026, 8, 10, tzinfo=timezone.utc),
        "end": datetime(2026, 8, 12, tzinfo=timezone.utc),
    },
    geo={"type": "point", "center": {"lat": -45.0312, "lng": 168.6626}, "radius_km": 30.0},
    raw_payload={},
)


def _mock_conn(rows: list[dict]):
    columns = list(rows[0].keys()) if rows else []
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.description = [MagicMock() for _ in columns]
    for col_mock, name in zip(cursor.description, columns):
        col_mock.name = name
    cursor.fetchall.return_value = [tuple(row[col] for col in columns) for row in rows]
    conn = MagicMock()
    conn.cursor.return_value = cursor
    return conn


def _state(event: DisruptionEvent) -> dict:
    return {"disruption_event": event.model_dump(mode="json"), "messages": []}


def test_reuses_matcher_and_filters_by_radius():
    rows = [
        {  # 就在事件中心，命中
            "booking_id": "11111111-0000-0000-0000-000000000001",
            "hotel_id": "22222222-0000-0000-0000-000000000001",
            "guest_id": "33333333-0000-0000-0000-000000000001",
            "check_in": date(2026, 8, 10),
            "check_out": date(2026, 8, 12),
            "hotel_name": "Queenstown Lakeview Hotel",
            "lat": -45.0312,
            "lng": 168.6626,
        },
        {  # 奥克兰，半径外，应被 matcher 的距离过滤掉
            "booking_id": "11111111-0000-0000-0000-000000000002",
            "hotel_id": "22222222-0000-0000-0000-000000000002",
            "guest_id": "33333333-0000-0000-0000-000000000002",
            "check_in": date(2026, 8, 11),
            "check_out": date(2026, 8, 13),
            "hotel_name": "Auckland Faraway Inn",
            "lat": -36.8485,
            "lng": 174.7633,
        },
    ]
    conn = _mock_conn(rows)

    out = identify_bookings(_state(_EVENT), {"configurable": {"connect": lambda: conn}})

    assert [b["booking_id"] for b in out["affected_bookings"]] == [
        "11111111-0000-0000-0000-000000000001"
    ]
    conn.close.assert_called_once()


def test_serialises_rows_to_json_safe_types():
    rows = [
        {
            "booking_id": "11111111-0000-0000-0000-000000000001",
            "hotel_id": "22222222-0000-0000-0000-000000000001",
            "guest_id": "33333333-0000-0000-0000-000000000001",
            "check_in": date(2026, 8, 10),
            "check_out": date(2026, 8, 12),
            "hotel_name": "Queenstown Lakeview Hotel",
            "lat": -45.0312,
            "lng": 168.6626,
        }
    ]
    out = identify_bookings(_state(_EVENT), {"configurable": {"connect": lambda: _mock_conn(rows)}})

    booking = out["affected_bookings"][0]
    assert booking["check_in"] == "2026-08-10" and booking["check_out"] == "2026-08-12"
    assert all(isinstance(v, str) for v in (booking["booking_id"], booking["guest_id"], booking["hotel_id"]))


def test_no_candidates_returns_empty_list():
    out = identify_bookings(_state(_EVENT), {"configurable": {"connect": lambda: _mock_conn([])}})
    assert out == {"affected_bookings": []}
