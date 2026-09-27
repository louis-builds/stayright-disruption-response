"""identify_bookings node: goes through MCP to call the kakapo-identify server, tested without a real database.

Uses an in-process MCPServer instance as the connection target (skipping the subprocess),
and mocks out get_connection in the server module — CI has no postgres, real-database
verification goes through scripts/run_agent_demo.py or scripts/run_agent_pipeline.py.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from unittest.mock import MagicMock

import pytest

from agent.nodes import identify_bookings
from src.detect.models import DisruptionEvent
from src.mcp_server import identify_server

# Near Queenstown Lakeview Hotel; storm event radius 30km
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

_IN_RADIUS = {
    "booking_id": "11111111-0000-0000-0000-000000000001",
    "hotel_id": "22222222-0000-0000-0000-000000000001",
    "guest_id": "33333333-0000-0000-0000-000000000001",
    "check_in": date(2026, 8, 10),
    "check_out": date(2026, 8, 12),
    "hotel_name": "Queenstown Lakeview Hotel",
    "lat": -45.0312,
    "lng": 168.6626,
}
_OUT_OF_RADIUS = {
    "booking_id": "11111111-0000-0000-0000-000000000002",
    "hotel_id": "22222222-0000-0000-0000-000000000002",
    "guest_id": "33333333-0000-0000-0000-000000000002",
    "check_in": date(2026, 8, 11),
    "check_out": date(2026, 8, 13),
    "hotel_name": "Auckland Faraway Inn",
    "lat": -36.8485,
    "lng": 174.7633,
}


def _mock_conn(rows: list[dict]):
    columns = list(rows[0].keys()) if rows else []
    cursor = MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.description = [MagicMock() for _ in columns]
    for col_mock, name in zip(cursor.description, columns):
        col_mock.name = name
    cursor.fetchall.return_value = [tuple(row[col] for col in columns) for row in rows]
    conn = MagicMock()
    conn.__enter__.return_value = conn
    conn.cursor.return_value = cursor
    return conn


@pytest.fixture
def rows(request, monkeypatch):
    """Make the server-side get_connection return a mock connection fed with the given rows."""
    conn = _mock_conn(request.param)
    monkeypatch.setattr(identify_server, "get_connection", lambda: conn)
    return conn


def _run(event: DisruptionEvent) -> dict:
    state = {"disruption_event": event.model_dump(mode="json"), "messages": []}
    config = {"configurable": {"identify_server": identify_server.mcp}}
    return asyncio.run(identify_bookings(state, config))


@pytest.mark.parametrize("rows", [[_IN_RADIUS, _OUT_OF_RADIUS]], indirect=True)
def test_reuses_matcher_and_filters_by_radius(rows):
    out = _run(_EVENT)
    assert [b["booking_id"] for b in out["affected_bookings"]] == [_IN_RADIUS["booking_id"]]


@pytest.mark.parametrize("rows", [[_IN_RADIUS]], indirect=True)
def test_server_serialises_rows_to_json_safe_types(rows):
    booking = _run(_EVENT)["affected_bookings"][0]

    assert booking["check_in"] == "2026-08-10" and booking["check_out"] == "2026-08-12"
    assert all(isinstance(booking[key], str) for key in ("booking_id", "guest_id", "hotel_id"))


@pytest.mark.parametrize("rows", [[]], indirect=True)
def test_no_candidates_returns_empty_list(rows):
    assert _run(_EVENT) == {"affected_bookings": []}


@pytest.mark.parametrize("rows", [[]], indirect=True)
def test_server_exposes_matched_bookings_tool(rows):
    from agent.mcp_client import load_mcp_tools

    tools = {tool.name: tool for tool in asyncio.run(load_mcp_tools(identify_server.mcp))}

    assert "matched_bookings" in tools
    assert "disruption_event" in tools["matched_bookings"].args_schema["properties"]
