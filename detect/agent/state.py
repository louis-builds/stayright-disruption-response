"""The graph's state shape, and the constructor that turns a detector's DisruptionEvent
into the graph's initial state."""

from __future__ import annotations

import operator
from typing import Any, Optional

from langchain.messages import AnyMessage, HumanMessage
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
    messages: Annotated[list[AnyMessage], operator.add]
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
