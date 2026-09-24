"""Poll the four signal sources and, whenever a regional-scale disruption
(DisruptionEvent) is detected, feed it into the LangGraph flow assembled in
agent/graph.py.

  collectors (detect_*_events) -> list[DisruptionEvent] -> dedup -> build_initial_state
  -> graph.stream(...)  runs the graph node by node

Same demo trick as scripts/run_demo.py: poll the real APIs for the first few rounds, then
at round --mock-at (default 3) swap only **flight** for fake data (AKL mass cancellation),
while the other sources keep polling real APIs. Real weather/volcano/road rarely actually
trigger, so this mock flight round is what demonstrates the whole chain end to end.
--mock-at 0 disables the injection; --simulate fakes all four sources instead.

By default the graph **stops right after identify_bookings** (interrupt_after +
InMemorySaver) — check_needs_escalation and everything downstream is a teammate's work in
progress and isn't run yet. Pass --full to run the whole graph (needs GEMINI_API_KEY and
some quota left).

Usage:
    python -m scripts.run_agent_pipeline --interval 10 --iterations 3   # 2 real rounds, mock flight injected on round 3, then stop
    python -m scripts.run_agent_pipeline                                # poll forever, real APIs each round, mock flight on round 3
    python -m scripts.run_agent_pipeline --mock-at 0                    # pure real polling, no injection
    python -m scripts.run_agent_pipeline --simulate --once             # all four sources fake, run once

Prerequisite: the Postgres from docker compose is up, and the C# backend has been run at
least once to seed data (identify_bookings queries the real hotels/bookings tables).
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from langgraph.checkpoint.memory import InMemorySaver

from agent import build_agent_graph, build_initial_state
from scripts.run_detect import (
    _sim_flight_status,
    _sim_forecast,
    _sim_road_events,
    _sim_volcano_alerts,
)
from src.detect.dedup import should_report
from src.detect.flight_status import detect_flight_events
from src.detect.geonet_volcano import detect_volcano_events
from src.detect.models import DisruptionEvent
from src.detect.nzta_road import detect_road_events
from src.detect.open_meteo import detect_events as detect_weather_events

SOURCE_CHOICES = ["weather", "volcano", "flight", "road", "all"]
STOP_AFTER_NODE = "identify_bookings"  # when not --full, the graph interrupts right after this node


async def compile_graph(*, full: bool):
    """Compile the agent graph. In non-full mode, interrupt_after stops it right
    after identify_bookings — everything downstream (check_needs_escalation / notify /
    recommend_options, …) never runs.

    build_agent_graph needs an await (MCP tools connect to the server once during assembly to fetch schema).
    """
    kwargs: dict = {"checkpointer": InMemorySaver()}
    if not full:
        kwargs["interrupt_after"] = [STOP_AFTER_NODE]
    return (await build_agent_graph()).compile(**kwargs)


def poll_sources(sources: list[str], *, simulate: bool, mock_flight: bool = False) -> list[DisruptionEvent]:
    """Poll the selected sources and return every DisruptionEvent that cleared the
    "regional scale" threshold.

    simulate=True: all four sources use fake data.
    mock_flight=True: only flight uses fake data (AKL mass cancellation); the rest keep polling real APIs.
    """
    events: list[DisruptionEvent] = []

    if "weather" in sources:
        try:
            events += detect_weather_events(fetch=_sim_forecast) if simulate else detect_weather_events()
        except Exception as exc:  # noqa: BLE001 - manual tool, print and keep going
            print(f"  weather source poll failed: {exc!r}")

    if "volcano" in sources:
        try:
            events += detect_volcano_events(fetch=_sim_volcano_alerts) if simulate else detect_volcano_events()
        except Exception as exc:  # noqa: BLE001
            print(f"  volcano source poll failed: {exc!r}")

    if "flight" in sources:
        if simulate or mock_flight:
            events += detect_flight_events(fetch=_sim_flight_status)
        elif os.environ.get("RAPIDAPI_KEY"):
            try:
                events += detect_flight_events(api_key=os.environ["RAPIDAPI_KEY"])
            except Exception as exc:  # noqa: BLE001 - manual tool, print and keep going
                print(f"  flight source poll failed: {exc!r}")
        else:
            print("  flight source skipped: RAPIDAPI_KEY not set (no mock flight data this round)")

    if "road" in sources:
        try:
            events += detect_road_events(fetch=_sim_road_events) if simulate else detect_road_events()
        except Exception as exc:  # noqa: BLE001
            print(f"  road source poll failed: {exc!r}")

    return events


def _dedup_key(event: DisruptionEvent) -> str:
    """A "location name" for dedup purposes: prefer a readable label from raw_payload, else fall back to coordinates."""
    payload = event.raw_payload or {}
    for key in ("location", "airport_iata", "volcano_title", "sole_access_route", "road_number"):
        if payload.get(key):
            return str(payload[key])
    return f"{event.geo.center.lat:.2f},{event.geo.center.lng:.2f}"


def describe_event(event: DisruptionEvent) -> str:
    """A one-line summary of what this event is and why it was judged a disruption (for human review, not the full payload)."""
    p = event.raw_payload or {}
    w = event.affects_window
    window = f"{w.start:%Y-%m-%d %H:%M}→{w.end:%Y-%m-%d %H:%M}Z"
    head = f"[{event.source.value}/{event.event_type}/{event.severity.value}]"

    if event.source.value == "weather":
        why = (f"weather_code={p.get('weather_code')} precip={p.get('precipitation')}mm "
               f"snow={p.get('snowfall')}cm @ {p.get('location')}")
    elif event.source.value == "volcano":
        why = (f"{p.get('volcano_title')} VAL={p.get('alert_level')} "
               f"aviation={p.get('aviation_colour_code')} — {p.get('activity')}")
    elif event.source.value == "flight":
        frac = p.get("cancelled_fraction")
        why = (f"{p.get('airport_iata')}: {p.get('cancelled_count')}/{p.get('scheduled_count')} "
               f"departures cancelled ({frac:.0%})" if isinstance(frac, (int, float))
               else f"{p.get('airport_iata')}: {p.get('cancelled_count')}/{p.get('scheduled_count')} cancelled")
    elif event.source.value == "road":
        why = (f"{p.get('road_number')} ({p.get('sole_access_route')}) — {p.get('impact')}, "
               f"detour={p.get('detour_available')}")
    else:
        why = str(p)

    return f"{head} {why} | window {window}"


async def run_event_through_graph(event: DisruptionEvent, graph, *, full: bool) -> None:
    """Feed one DisruptionEvent into the graph, printing each node's output as it runs.

    In non-full mode, the graph interrupts right after identify_bookings — check_needs_escalation
    and everything after it never runs. identify_bookings / recommend_* nodes go through MCP
    (async), so this uses astream.
    """
    state = build_initial_state(event)
    config = {"configurable": {"thread_id": event.event_id}}
    print(f"  event {event.event_id} [{event.source.value}/{event.event_type}] -> entering graph")

    async for step in graph.astream(state, config, stream_mode="updates"):
        for node, update in step.items():
            if node == "__interrupt__":
                continue  # langgraph's interrupt signal, not a real node
            if node == "identify_bookings":
                bookings = update.get("affected_bookings") or []
                print(f"    identify_bookings -> {len(bookings)} affected booking(s)")
                for b in bookings:
                    print(f"      - {b['booking_id']} / guest {b['guest_id']} / {b['hotel_name']} "
                          f"({b['check_in']} -> {b['check_out']})")
            elif node == "check_needs_escalation":
                print(f"    check_needs_escalation -> needs_escalation={update.get('needs_escalation')} "
                      f"reason={update.get('escalation_reason')}")
            else:
                print(f"    {node} -> {update}")

    if not full:
        print(f"    (graph interrupted after {STOP_AFTER_NODE}; downstream nodes are a teammate's work in progress, pass --full to run them)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=SOURCE_CHOICES, default="all", help="which source(s) to poll (default: all)")
    parser.add_argument("--simulate", action="store_true", help="fake data for all four sources, no real API calls")
    parser.add_argument("--mock-at", type=int, default=3,
                        help="which round injects fake flight data (1-indexed, default 3); 0 = no injection, pure real polling")
    parser.add_argument("--interval", type=float, default=60.0, help="seconds between polls (default 60)")
    parser.add_argument("--iterations", type=int, default=0, help="stop after N rounds (default 0 = run forever)")
    parser.add_argument("--once", action="store_true", help="poll once and exit (equivalent to --iterations 1)")
    parser.add_argument("--full", action="store_true", help="run the whole graph (including LLM nodes like recommend_options; needs GEMINI_API_KEY)")
    parser.add_argument("--dedup-cooldown-minutes", type=float, default=60.0,
                        help="don't re-feed the same location+event type into the graph within this window unless severity increases (default 60; 0 disables)")
    parser.add_argument("--dedup-state", type=Path, default=Path("output/.agent_pipeline_dedup.json"),
                        help="path to the dedup state file")
    args = parser.parse_args()

    load_dotenv()
    # get both identify_bookings' "calling ... via MCP" log and the subprocess's matched_bookings log onto the console
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    sources = list(SOURCE_CHOICES[:-1]) if args.source == "all" else [args.source]
    max_iterations = 1 if args.once else args.iterations
    graph = asyncio.run(compile_graph(full=args.full))

    print(f"run_agent_pipeline ({'simulate' if args.simulate else 'live'}) "
          f"sources={sources} interval={args.interval:g}s "
          f"{'full graph' if args.full else 'stop after ' + STOP_AFTER_NODE}")

    iteration = 0
    try:
        while True:
            iteration += 1
            now = datetime.now(timezone.utc)
            mock_flight = bool(args.mock_at) and iteration == args.mock_at and not args.simulate
            print(f"\n[{now.isoformat(timespec='seconds')}] #{iteration} polling…")

            events = poll_sources(sources, simulate=args.simulate, mock_flight=mock_flight)
            print(f"  detected {len(events)} event(s):")
            for event in events:
                print(f"    · {event.event_id}  {describe_event(event)}")

            for event in events:
                if args.dedup_cooldown_minutes > 0 and not should_report(
                    args.dedup_state, _dedup_key(event), event.event_type,
                    event.severity.value, args.dedup_cooldown_minutes, now,
                ):
                    print(f"  event {event.event_id} [{_dedup_key(event)}/{event.event_type}] "
                          f"skipped (already fed within {args.dedup_cooldown_minutes:g} min, severity unchanged)")
                    continue
                asyncio.run(run_event_through_graph(event, graph, full=args.full))

            if max_iterations and iteration >= max_iterations:
                print("\nReached iteration limit, stopping.")
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
