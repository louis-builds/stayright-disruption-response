"""The graph's state shape, and the constructor that turns a detector's DisruptionEvent
into the graph's initial state."""

from __future__ import annotations

from typing import Any, Optional

from langchain.messages import AnyMessage, HumanMessage
from langgraph.graph.message import add_messages
from typing_extensions import Annotated, TypedDict

from src.detect.models import DisruptionEvent


class DisruptionState(TypedDict):
    disruption_event: dict[str, Any]
    affected_bookings: Optional[list[dict[str, Any]]]
    needs_escalation: Optional[bool]
    escalation_reason: Optional[str]
    ranking_confidence: Optional[float]
    booking_success: Optional[bool]
    final_message: Optional[str]
    # add_messages (not plain operator.add) coerces plain dicts into real BaseMessage
    # objects -- code that builds state itself (build_initial_state below) always
    # constructs proper HumanMessage/etc. instances so this didn't matter there, but
    # LangGraph Studio submits messages as JSON dicts, which operator.add would leave
    # as dicts instead of real messages, and the model client can't read those.
    messages: Annotated[list[AnyMessage], add_messages]
    llm_calls: int


def build_initial_state(event: DisruptionEvent) -> DisruptionState:
    """Turn a DisruptionEvent (produced by a detector) into the graph's initial state."""
    window = event.affects_window
    return {
        "disruption_event": event.model_dump(mode="json"),
        "messages": [
            HumanMessage(
                content=(
                    f"A {event.severity.value}-severity {event.source.value} disruption "
                    f"({event.event_type}) near ({event.geo.center.lat:.4f}, "
                    f"{event.geo.center.lng:.4f}), radius {event.geo.radius_km:g} km, "
                    f"affecting {window.start:%Y-%m-%d} to {window.end:%Y-%m-%d}. "
                    "Find alternative accommodation options for affected guests."
                )
            )
        ],
        "llm_calls": 0,
    }
