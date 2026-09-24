"""Fast, no-DB, no-MCP-subprocess regression tests for the pure parts of the agent
(agent/mcp_client.py's MCP result unwrapping, agent/nodes.py's routing logic). These run
on every push (see buildspec-gate.yml) precisely because they're cheap and catch the
kind of change most likely to silently break the agent's control flow — a routing
threshold, a stub's return shape, the MCP unwrap contract — without needing Postgres or
a live LLM.

Slower, integration-shaped coverage of the actual MCP round-trip lives in
tests/test_mcp_identify.py; this file only covers what needs zero I/O.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from agent.mcp_client import _unwrap
from agent.nodes import (
    check_needs_escalation,
    coordinate_booking,
    escalate_to_human,
    notify_affected_guest,
    route_after_escalation_check,
    route_after_recommendation,
)
from agent.state import build_initial_state
from src.detect.models import DisruptionEvent


def _mcp_result(*, is_error=False, structured_content=None, content=None):
    return SimpleNamespace(is_error=is_error, structured_content=structured_content, content=content)


class TestUnwrap:
    def test_raises_on_tool_error(self):
        result = _mcp_result(is_error=True, content="boom")
        with pytest.raises(RuntimeError, match="boom"):
            _unwrap(result)

    def test_strips_the_result_wrapper_mcpserver_adds_for_non_object_returns(self):
        # e.g. a tool declared to return list[dict] comes back as {"result": [...]}
        result = _mcp_result(structured_content={"result": [{"booking_id": "b1"}]})
        assert _unwrap(result) == [{"booking_id": "b1"}]

    def test_passes_through_a_real_object_payload_unchanged(self):
        # structured_content that isn't just {"result": ...} is the tool's real object return
        result = _mcp_result(structured_content={"property_id": "P001", "price": 189})
        assert _unwrap(result) == {"property_id": "P001", "price": 189}

    def test_falls_back_to_text_blocks_when_nothing_structured_came_back(self):
        block = SimpleNamespace(text="plain text answer")
        result = _mcp_result(structured_content=None, content=[block])
        assert _unwrap(result) == ["plain text answer"]


class TestRouteAfterEscalationCheck:
    def test_escalates_when_flagged(self):
        assert route_after_escalation_check({"needs_escalation": True}) == "escalate_to_human"

    def test_notifies_guest_otherwise(self):
        assert route_after_escalation_check({"needs_escalation": False}) == "notify_affected_guest"
        assert route_after_escalation_check({}) == "notify_affected_guest"


class TestRouteAfterRecommendation:
    def _state(self, *, tool_calls=None, ranking_confidence=None):
        last_message = SimpleNamespace(tool_calls=tool_calls)
        return {"messages": [last_message], "ranking_confidence": ranking_confidence}

    def test_goes_back_to_tools_while_the_llm_still_wants_to_call_one(self):
        state = self._state(tool_calls=[{"name": "search_alternative_properties"}])
        assert route_after_recommendation(state) == "execute_recommendation_tools"

    def test_escalates_on_low_confidence_once_tool_calls_are_done(self):
        state = self._state(tool_calls=[], ranking_confidence=0.3)
        assert route_after_recommendation(state) == "escalate_to_human"

    def test_proceeds_to_generate_message_on_high_confidence(self):
        state = self._state(tool_calls=[], ranking_confidence=0.9)
        assert route_after_recommendation(state) == "generate_message"

    def test_defaults_to_high_confidence_when_none_was_ever_set(self):
        # ranking_confidence is only set when recommend_options stopped calling tools;
        # a missing value must not accidentally read as "low confidence, escalate"
        state = self._state(tool_calls=[], ranking_confidence=None)
        assert route_after_recommendation(state) == "generate_message"


class TestOrchestrationStubs:
    """These nodes are still placeholders (see their TODOs); pin down their current
    contract so a change to the stub's shape is a deliberate, visible diff."""

    def test_check_needs_escalation_never_escalates_yet(self):
        assert check_needs_escalation({}) == {"needs_escalation": False, "escalation_reason": None}

    def test_notify_affected_guest_is_a_noop_for_now(self):
        assert notify_affected_guest({}) == {}

    def test_coordinate_booking_reports_success_for_now(self):
        assert coordinate_booking({}) == {"booking_success": True}

    def test_escalate_to_human_sets_a_final_message(self):
        assert "Escalated" in escalate_to_human({})["final_message"]


class TestBuildInitialState:
    def test_shapes_a_disruption_event_into_the_graph_state(self):
        now = datetime(2026, 9, 16, tzinfo=timezone.utc)
        event = DisruptionEvent(
            source="flight",
            event_type="mass_flight_cancellation",
            severity="high",
            detected_at=now,
            affects_window={"start": now, "end": now + timedelta(hours=3)},
            geo={"type": "point", "center": {"lat": -37.0082, "lng": 174.7850}, "radius_km": 40.0},
            raw_payload={"airport_iata": "AKL"},
        )

        state = build_initial_state(event)

        assert state["llm_calls"] == 0
        assert state["disruption_event"]["source"] == "flight"
        assert len(state["messages"]) == 1
        content = state["messages"][0].content
        assert "high-severity flight disruption" in content
        assert "mass_flight_cancellation" in content
