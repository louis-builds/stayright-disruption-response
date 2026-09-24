"""Manual one-shot demo: run the full agent graph against a hand-built sample event
and print the result, plus save a PNG of the graph structure.

    cd detect && .venv/Scripts/python -m scripts.run_agent_demo
"""

from __future__ import annotations

import asyncio
import pathlib
from datetime import datetime, timedelta, timezone

from agent import build_initial_state, get_agent
from src.detect.models import DisruptionEvent

# Sample event: Queenstown Lakeview Hotel's coordinates, window now..+30d
_NOW = datetime.now(timezone.utc)
sample_event = DisruptionEvent(
    source="weather",
    event_type="storm",
    severity="high",
    detected_at=_NOW,
    affects_window={"start": _NOW, "end": _NOW + timedelta(days=30)},
    geo={
        "type": "point",
        "center": {"lat": -45.0312, "lng": 168.6626},
        "radius_km": 30.0,
    },
    raw_payload={"note": "hand-built sample event"},
)


async def main() -> None:
    agent = await get_agent()

    # try:
    #     png_bytes = agent.get_graph(xray=True).draw_mermaid_png()
    #     pathlib.Path("kakapo_graph.png").write_bytes(png_bytes)
    #     print("Saved graph diagram to kakapo_graph.png")
    # except Exception as e:
    #     print(f"Could not render graph diagram: {e}")

    result = await agent.ainvoke(build_initial_state(sample_event))
    print(f"\nidentify_bookings -> {len(result.get('affected_bookings') or [])} affected booking(s)")
    for booking in result.get("affected_bookings") or []:
        print(f"  - {booking['booking_id']} / guest {booking['guest_id']} / {booking['hotel_name']} "
              f"({booking['check_in']} -> {booking['check_out']})")
    for m in result["messages"]:
        m.pretty_print()


if __name__ == "__main__":
    asyncio.run(main())
