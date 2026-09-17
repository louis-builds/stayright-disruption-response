# =========================================================
# StayRight NZ Disruption Handling & Rebooking Agent — LangGraph skeleton
# Tools go through MCP: identify_server.py exposes tools that get turned
# into LangChain tools and wired into the graph. Non-LLM orchestration
# nodes are still placeholder stubs.
# =========================================================

# agent/ isn't under src/: hang detect/ on the import path so we can reuse src.* and agent.mcp_tools
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# ---------- Step 1: Model ----------
from dotenv import load_dotenv

load_dotenv()

from functools import lru_cache

from langchain.chat_models import init_chat_model


# Lazy init: init_chat_model needs GEMINI_API_KEY at construction time, so building it at
# module level would force a key even for callers who just want to import this module to
# run identify/routing tests. Only fetch it from the node that actually needs the LLM.
@lru_cache(maxsize=1)
def get_model():
    return init_chat_model("gemini-2.5-flash", model_provider="google_genai", temperature=0)


# ---------- MCP tool wiring ----------
# langchain-mcp-adapters only supports mcp 1.x, and this project is on mcp 2.x, so this
# glue is hand-rolled: connect to identify_server.py (a stdio subprocess) and turn the
# functions it exposes via @mcp.tool() into LangChain tools.
from langchain_core.tools import StructuredTool
from mcp import Client, StdioServerParameters

_IDENTIFY_SERVER = pathlib.Path(__file__).resolve().parents[1] / "src" / "mcp_server" / "identify_server.py"
# sys.executable rather than "python" — otherwise the subprocess uses the system Python and
# can't import psycopg / pydantic, which only live in .venv
IDENTIFY_STDIO = StdioServerParameters(command=sys.executable, args=[str(_IDENTIFY_SERVER)])


def _unwrap(result):
    """Pull out a tool's return value. MCPServer wraps a non-object return type (e.g.
    list[dict]) in {"result": ...} to satisfy the "structured content must be an object"
    requirement; strip that wrapper back off here."""
    if result.is_error:
        raise RuntimeError(f"MCP tool call failed: {result.content}")
    structured = result.structured_content
    if structured is None:
        return [block.text for block in result.content]
    if set(structured) == {"result"}:
        return structured["result"]
    return structured


def _as_langchain_tool(target, mcp_tool) -> StructuredTool:
    async def call(**kwargs):
        async with Client(target) as client:
            return _unwrap(await client.call_tool(mcp_tool.name, kwargs))

    return StructuredTool(
        name=mcp_tool.name,
        description=mcp_tool.description or "",
        args_schema=mcp_tool.input_schema,
        coroutine=call,
    )


async def load_mcp_tools(target=IDENTIFY_STDIO) -> list[StructuredTool]:
    """Connect to an MCP server and turn every tool it exposes into a LangChain tool.

    target defaults to "spawn identify_server.py as a subprocess"; you can also pass an
    in-process MCPServer instance directly (used by tests, to skip the subprocess cost).
    Each tool call opens a fresh connection — fine at the current scale.
    """
    async with Client(target) as client:
        listed = await client.list_tools()
    return [_as_langchain_tool(target, tool) for tool in listed.tools]


# ---------- Step 2: State ----------
import operator
from typing import Any, Optional

from langchain.messages import AnyMessage
from typing_extensions import Annotated, TypedDict


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


# ---------- Step 3: Nodes ----------
import logging

from langchain.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from src.detect.models import DisruptionEvent

log = logging.getLogger("kakapo.agent")


async def identify_bookings(state: DisruptionState, config: RunnableConfig | None = None) -> dict:
    """Look up affected bookings via MCP's matched_bookings tool on identify_server (no LLM).

    The connection target defaults to "spawn identify_server.py as a subprocess"
    (IDENTIFY_STDIO); tests can pass config["configurable"]["identify_server"] with an
    in-process MCPServer instance to run without a real database. The MCP boundary has
    already serialised UUID/date fields to strings, so what comes back here is a
    JSON-safe dict.
    """
    server = ((config or {}).get("configurable") or {}).get("identify_server", IDENTIFY_STDIO)
    log.info("LangGraph -> MCP: requesting matched_bookings from identify_server")
    tools = await load_mcp_tools(server)
    matched = next(tool for tool in tools if tool.name == "matched_bookings")
    rows = await matched.ainvoke({"disruption_event": state["disruption_event"]})
    log.info("MCP -> LangGraph: %d affected booking(s) returned", len(rows))
    return {"affected_bookings": list(rows)}


def check_case_type(state: DisruptionState) -> dict:
    """Decide whether this needs to escalate up front — group bookings, VIP, disputes (rule-based, no LLM)."""
    # TODO: replace with the real rule logic
    return {"needs_escalation": False, "escalation_reason": None}


def notify_affected_guest(state: DisruptionState) -> dict:
    """Email the affected guest to let them know their stay may be impacted (no concrete plan yet)."""
    # TODO: email
    return {}


def generate_message(state: DisruptionState) -> dict:
    """LLM node: write the final message to the guest summarising the outcome (no tools needed, just a summary).

    gemini-2.5-flash has a fairly high observed rate of returning finish_reason=STOP with
    output_tokens=0 on this node — cause unknown; setting thinking_budget=0 didn't change the
    reproduction rate either. A few retries usually get a non-empty result; if it stays empty,
    fall back to a canned message rather than let the guest get nothing.
    """
    prompt = [
        SystemMessage(content="Write a warm, clear message to the guest summarising the rebooking outcome.")
    ] + state["messages"]

    for _ in range(3):
        content = get_model().invoke(prompt).content
        if content:
            return {"final_message": content}

    return {"final_message": "We've found some rebooking options for your affected stay and will follow up shortly with the details."}


def coordinate_booking(state: DisruptionState) -> dict:
    """Cancel the original booking and book the new property (multi-step coordination, code execution)."""
    # TODO: replace with real cancel + book API calls, with failure retry
    return {"booking_success": True}


def escalate_to_human(state: DisruptionState) -> dict:
    """Escalate to a human, with the full context attached."""
    return {"final_message": "Escalated to human support with full context."}


# ---------- Step 4: Conditional edges ----------
from typing import Literal

from langgraph.graph import END, START, StateGraph


def route_after_case_check(state: DisruptionState) -> Literal["notify_affected_guest", "escalate_to_human"]:
    if state.get("needs_escalation"):
        return "escalate_to_human"
    return "notify_affected_guest"


def route_after_rank(state: DisruptionState) -> Literal["rank_tool_node", "generate_message", "escalate_to_human"]:
    last_message = state["messages"][-1]
    # The LLM still wants to call a tool (search properties / check policy) — back to the tool node
    if getattr(last_message, "tool_calls", None):
        return "rank_tool_node"
    # The LLM has given its final recommendation but confidence is too low — escalate
    if (state.get("ranking_confidence") or 1.0) < 0.6:
        return "escalate_to_human"
    return "generate_message"


# ---------- Step 5: Build the graph ----------
_agent = None


async def build_agent_graph() -> "StateGraph":
    """Assemble the (uncompiled) graph and return the builder. MCP tools need an await to
    fetch, so this is async.

    Callers compile it themselves and can pass a checkpointer / interrupt_after as needed —
    scripts/run_agent_pipeline.py relies on interrupt_after to stop the graph right after
    identify_bookings.
    """
    tools = await load_mcp_tools(IDENTIFY_STDIO)
    tools_by_name = {tool.name: tool for tool in tools}
    model_with_tools = get_model().bind_tools(tools)

    async def rank_and_explain(state: DisruptionState) -> dict:
        """LLM node: call MCP tools to search alternative properties + check the real
        policy, then produce a ranked recommendation with an explanation."""
        bookings = state.get("affected_bookings") or []
        bookings_summary = "\n".join(
            f"- Booking {b['booking_id']}: {b['hotel_name']}, {b['check_in']} to {b['check_out']}"
            for b in bookings
        ) or "(no affected bookings identified)"

        response = await model_with_tools.ainvoke(
            [
                SystemMessage(
                    content=(
                        "You are a travel disruption assistant for StayRight NZ. "
                        "Use the tools to search real alternative properties and "
                        "check their real cancellation policy before recommending "
                        "anything to the guest. Never invent policy terms.\n\n"
                        "Affected bookings:\n" + bookings_summary + "\n\n"
                        "Infer the city from each hotel's name when calling "
                        "search_alternative_properties. The guest's budget isn't "
                        "tracked yet, so use a reasonable mid-range NZD nightly rate "
                        "for the property type as budget_max."
                    )
                )
            ]
            + state["messages"]
        )

        result: dict = {
            "messages": [response],
            "llm_calls": state.get("llm_calls", 0) + 1,
        }
        if not response.tool_calls:
            # No tool called this whole turn = the LLM answered from nothing, with no real
            # property/policy data backing it up — lower the confidence so route_after_rank
            # escalates to a human.
            used_real_data = any(isinstance(m, ToolMessage) for m in state["messages"])
            result["ranking_confidence"] = 0.9 if used_real_data else 0.3
        return result

    async def rank_tool_node(state: DisruptionState) -> dict:
        """Execute the MCP tool(s) rank_and_explain decided to call. MCP tools are async, so use ainvoke."""
        result = []
        for tool_call in state["messages"][-1].tool_calls:
            tool = tools_by_name[tool_call["name"]]
            observation = await tool.ainvoke(tool_call["args"])
            result.append(ToolMessage(content=str(observation), tool_call_id=tool_call["id"]))
        return {"messages": result}

    builder = StateGraph(DisruptionState)

    builder.add_node("identify_bookings", identify_bookings)
    builder.add_node("check_case_type", check_case_type)
    builder.add_node("notify_affected_guest", notify_affected_guest)
    builder.add_node("rank_and_explain", rank_and_explain)
    builder.add_node("rank_tool_node", rank_tool_node)
    builder.add_node("coordinate_booking", coordinate_booking)
    builder.add_node("generate_message", generate_message)
    builder.add_node("escalate_to_human", escalate_to_human)

    builder.add_edge(START, "identify_bookings")
    builder.add_edge("identify_bookings", "check_case_type")
    builder.add_conditional_edges(
        "check_case_type",
        route_after_case_check,
        ["notify_affected_guest", "escalate_to_human"],
    )
    builder.add_edge("notify_affected_guest", "rank_and_explain")

    # rank_and_explain is internally a small ReAct loop:
    # LLM decides whether to call a tool -> tool runs -> back to the LLM -> until no more tool calls
    builder.add_conditional_edges(
        "rank_and_explain",
        route_after_rank,
        ["rank_tool_node", "generate_message", "escalate_to_human"],
    )
    builder.add_edge("rank_tool_node", "rank_and_explain")

    builder.add_edge("generate_message", "coordinate_booking")
    builder.add_edge("coordinate_booking", END)
    builder.add_edge("escalate_to_human", END)

    return builder


async def get_agent():
    """Compile with defaults (no checkpointer / interrupt) and cache it, for callers who
    just want to invoke the whole graph directly."""
    global _agent
    if _agent is None:
        _agent = (await build_agent_graph()).compile()
    return _agent


# ---------- Entry point for the detection pipeline ----------
from datetime import datetime, timedelta, timezone


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


# Sample event for running this module directly: Queenstown Lakeview Hotel's coordinates, window now..+30d
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


async def _main() -> None:
    agent = await get_agent()

    try:
        png_bytes = agent.get_graph(xray=True).draw_mermaid_png()
        pathlib.Path("kakapo_graph.png").write_bytes(png_bytes)
        print("Saved graph diagram to kakapo_graph.png")
    except Exception as e:
        print(f"Could not render graph diagram: {e}")

    result = await agent.ainvoke(build_initial_state(sample_event))
    print(f"\nidentify_bookings -> {len(result.get('affected_bookings') or [])} affected booking(s)")
    for booking in result.get("affected_bookings") or []:
        print(f"  - {booking['booking_id']} / guest {booking['guest_id']} / {booking['hotel_name']} "
              f"({booking['check_in']} -> {booking['check_out']})")
    for m in result["messages"]:
        m.pretty_print()


if __name__ == "__main__":
    import asyncio

    asyncio.run(_main())
