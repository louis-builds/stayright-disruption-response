"""轮询四个信号源，探测到区域级扰动（DisruptionEvent）就把它喂进
agent/langgraph_framework.py 的 LangGraph 流程。

  采集器(detect_*_events) -> list[DisruptionEvent] -> 去重 -> build_initial_state
  -> graph.stream(...)  逐节点跑图

跟 scripts/run_demo.py 一样的演示套路：前几轮打真实 API，到第 --mock-at 轮（默认第 3 轮）
只把**航班**换成假数据（AKL 大面积取消），其余源照常打真实 API。真实天气/火山/道路很少
真的触发，靠这轮航班假数据把整条链路演示出来。--mock-at 0 关闭注入，--simulate 则四个源
全用假数据。

默认**跑到 identify_bookings 就停**（interrupt_after + InMemorySaver）——check_case_type
往后是队友在做的节点，暂时不跑。加 --full 才把整张图跑完（要 GEMINI_API_KEY 且没超配额）。

用法：
    python -m scripts.run_agent_pipeline --interval 10 --iterations 3   # 真实轮询 2 轮，第 3 轮注入航班假数据后停
    python -m scripts.run_agent_pipeline                                # 一直轮询，每轮真实 API，第 3 轮注入航班假数据
    python -m scripts.run_agent_pipeline --mock-at 0                    # 纯真实轮询，不注入
    python -m scripts.run_agent_pipeline --simulate --once             # 四源全假，跑一遍

前置：docker compose 里的 Postgres 起着、且 C# 后端至少灌过一次种子数据
（identify_bookings 要查真实 hotels/bookings 表）。
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

from agent.langgraph_framework import build_agent_graph, build_initial_state
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
STOP_AFTER_NODE = "identify_bookings"  # 非 --full 时，图跑到这个节点就中断


async def compile_graph(*, full: bool):
    """编译 langgraph_framework 的图。非 full 模式用 interrupt_after 让它跑完 identify_bookings 就停，
    下游（check_case_type / notify / rank_and_explain …）一律不执行。

    build_agent_graph 要 await（MCP 工具在装配期就要连一次 server 拿 schema）。"""
    kwargs: dict = {"checkpointer": InMemorySaver()}
    if not full:
        kwargs["interrupt_after"] = [STOP_AFTER_NODE]
    return (await build_agent_graph()).compile(**kwargs)


def poll_sources(sources: list[str], *, simulate: bool, mock_flight: bool = False) -> list[DisruptionEvent]:
    """轮询选中的源，返回所有清过"区域级"门槛的 DisruptionEvent。

    simulate=True：四个源全用假数据。
    mock_flight=True：仅航班用假数据（AKL 大面积取消），其余源照常打真实 API。
    """
    events: list[DisruptionEvent] = []

    if "weather" in sources:
        events += detect_weather_events(fetch=_sim_forecast) if simulate else detect_weather_events()

    if "volcano" in sources:
        events += detect_volcano_events(fetch=_sim_volcano_alerts) if simulate else detect_volcano_events()

    if "flight" in sources:
        if simulate or mock_flight:
            events += detect_flight_events(fetch=_sim_flight_status)
        elif os.environ.get("RAPIDAPI_KEY"):
            try:
                events += detect_flight_events(api_key=os.environ["RAPIDAPI_KEY"])
            except Exception as exc:  # noqa: BLE001 - 手动工具，打出来接着跑
                print(f"  flight 源轮询失败：{exc!r}")
        else:
            print("  flight 源跳过：没设 RAPIDAPI_KEY（本轮无航班假数据注入）")

    if "road" in sources:
        try:
            events += detect_road_events(fetch=_sim_road_events) if simulate else detect_road_events()
        except Exception as exc:  # noqa: BLE001
            print(f"  road 源轮询失败：{exc!r}")

    return events


def _dedup_key(event: DisruptionEvent) -> str:
    """给去重用的"位置名"：优先用 raw_payload 里的可读标签，否则退回坐标。"""
    payload = event.raw_payload or {}
    for key in ("location", "airport_iata", "volcano_title", "sole_access_route", "road_number"):
        if payload.get(key):
            return str(payload[key])
    return f"{event.geo.center.lat:.2f},{event.geo.center.lng:.2f}"


def describe_event(event: DisruptionEvent) -> str:
    """一行说明：这个事件是什么、凭什么判定为扰动（供人工核实，不打全量）。"""
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
    """把一个 DisruptionEvent 灌进图，逐节点打印产出。

    非 full 模式下图在 identify_bookings 后 interrupt，check_case_type 及之后一律不跑。
    identify_bookings / rank_* 节点走 MCP（async），所以用 astream。
    """
    state = build_initial_state(event)
    config = {"configurable": {"thread_id": event.event_id}}
    print(f"  event {event.event_id} [{event.source.value}/{event.event_type}] -> 进入图")

    async for step in graph.astream(state, config, stream_mode="updates"):
        for node, update in step.items():
            if node == "__interrupt__":
                continue  # langgraph 的中断信号，不是真节点
            if node == "identify_bookings":
                bookings = update.get("affected_bookings") or []
                print(f"    identify_bookings -> {len(bookings)} 条受影响订单")
                for b in bookings:
                    print(f"      - {b['booking_id']} / guest {b['guest_id']} / {b['hotel_name']} "
                          f"({b['check_in']} -> {b['check_out']})")
            elif node == "check_case_type":
                print(f"    check_case_type -> needs_escalation={update.get('needs_escalation')} "
                      f"reason={update.get('escalation_reason')}")
            else:
                print(f"    {node} -> {update}")

    if not full:
        print(f"    （图在 {STOP_AFTER_NODE} 后中断；下游节点是队友的工作，--full 才跑）")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=SOURCE_CHOICES, default="all", help="轮询哪个源（默认 all）")
    parser.add_argument("--simulate", action="store_true", help="四个源全用假数据，不打真实 API")
    parser.add_argument("--mock-at", type=int, default=3,
                        help="第几轮注入航班假数据（1-indexed，默认 3）；0 = 不注入，纯真实轮询")
    parser.add_argument("--interval", type=float, default=60.0, help="两次轮询间隔秒数（默认 60）")
    parser.add_argument("--iterations", type=int, default=0, help="跑 N 轮后停（默认 0 = 一直跑）")
    parser.add_argument("--once", action="store_true", help="只轮询一轮就退出（等价 --iterations 1）")
    parser.add_argument("--full", action="store_true", help="跑完整个图（含 rank_and_explain 等 LLM 节点，要 GEMINI_API_KEY）")
    parser.add_argument("--dedup-cooldown-minutes", type=float, default=60.0,
                        help="同一位置+事件类型在这个窗口内不重复喂图，除非严重度升级（默认 60；0 关闭）")
    parser.add_argument("--dedup-state", type=Path, default=Path("output/.agent_pipeline_dedup.json"),
                        help="去重状态文件路径")
    args = parser.parse_args()

    load_dotenv()
    # 让 identify_bookings 的「经 MCP 调 …」和子进程 matched_bookings 的日志都打到控制台
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
            marker = "（本轮注入航班假数据）" if mock_flight else ""
            print(f"\n[{now.isoformat(timespec='seconds')}] #{iteration} 轮询中…{marker}")

            events = poll_sources(sources, simulate=args.simulate, mock_flight=mock_flight)
            print(f"  探测到 {len(events)} 个事件：")
            for event in events:
                print(f"    · {event.event_id}  {describe_event(event)}")

            for event in events:
                if args.dedup_cooldown_minutes > 0 and not should_report(
                    args.dedup_state, _dedup_key(event), event.event_type,
                    event.severity.value, args.dedup_cooldown_minutes, now,
                ):
                    print(f"  event {event.event_id} [{_dedup_key(event)}/{event.event_type}] "
                          f"跳过（{args.dedup_cooldown_minutes:g} 分钟内已喂过、严重度没升级）")
                    continue
                asyncio.run(run_event_through_graph(event, graph, full=args.full))

            if max_iterations and iteration >= max_iterations:
                print("\n达到轮次上限，停止。")
                break
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
