"""Assembles the LangGraph state graph: wires the node functions in agent/nodes.py
together, plus the two tool-calling nodes (recommend_options / execute_recommendation_tools)
that stay here rather than in nodes.py because they close over the MCP tool list fetched
once at assembly time (needed to bind the tools to the model)."""

from __future__ import annotations

from langchain.messages import SystemMessage, ToolMessage
from langgraph.graph import END, START, StateGraph

from agent.mcp_client import BACKEND_MCP_URL, IDENTIFY_STDIO, load_mcp_tools

from agent.nodes import (
    check_needs_escalation,
    coordinate_booking,
    escalate_to_human,
    generate_message,
    get_model,
    identify_bookings,
    log,
    notify_affected_guest,
    route_after_escalation_check,
    route_after_recommendation,
)
from agent.state import DisruptionState

_agent = None


async def build_agent_graph() -> StateGraph:
    """Assemble the (uncompiled) graph and return the builder. MCP tools need an await to
    fetch, so this is async.

    Callers compile it themselves and can pass a checkpointer / interrupt_after as needed —
    scripts/run_agent_pipeline.py relies on interrupt_after to stop the graph right after
    identify_bookings.
    """
    all_tools = await load_mcp_tools(IDENTIFY_STDIO) + await load_mcp_tools(BACKEND_MCP_URL)
    # identify_server also exposes matched_bookings, but that's for the deterministic
    # identify_bookings node only -- it takes a DisruptionEvent, which nothing in this
    # ReAct loop has any business constructing. Scope the model's tools to what
    # recommend_options is actually meant to use, so it can't wander into calling it.
    RECOMMENDATION_TOOL_NAMES = {"search_alternative_properties", "get_cancellation_policy"}
    tools = [tool for tool in all_tools if tool.name in RECOMMENDATION_TOOL_NAMES]
    tools_by_name = {tool.name: tool for tool in tools}
    model_with_tools = get_model().bind_tools(tools)

    async def recommend_options(state: DisruptionState) -> dict:
        """LLM node: call MCP tools to search alternative properties + check the real
        policy, then produce a ranked recommendation with an explanation."""
        bookings = state.get("affected_bookings") or []
        bookings_summary = "\n".join(
            f"- Booking {b['booking_id']}: {b['hotel_name']} (hotel_id={b['hotel_id']}), "
            f"{b['check_in']} to {b['check_out']}"
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
                        "for the property type as budget_max. When calling "
                        "get_cancellation_policy, pass the booking's hotel_id shown above."
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
            # property/policy data backing it up — lower the confidence so
            # route_after_recommendation escalates to a human.
            used_real_data = any(isinstance(m, ToolMessage) for m in state["messages"])
            result["ranking_confidence"] = 0.9 if used_real_data else 0.3
        return result

    async def execute_recommendation_tools(state: DisruptionState) -> dict:
        """Execute the MCP tool(s) recommend_options decided to call. MCP tools are async, so use ainvoke.

        A tool call crossing an MCP boundary (network hiccup, the model passing a malformed
        argument, the remote server erroring) is treated as a normal, recoverable outcome, not
        a reason to crash the whole graph run: the failure is reported back as the
        ToolMessage's content, exactly like a successful result would be, so the model sees it
        on the next turn and can retry with corrected arguments or give up gracefully instead
        of taking the whole agent down with it.
        """
        result = []
        for tool_call in state["messages"][-1].tool_calls:
            tool = tools_by_name[tool_call["name"]]
            try:
                observation = await tool.ainvoke(tool_call["args"])
            except Exception as exc:  # noqa: BLE001 - deliberately broad: any failure becomes tool output, not a crash
                log.warning("Tool call %s failed: %r", tool_call["name"], exc)
                observation = f"Error calling {tool_call['name']}: {exc}"
            result.append(ToolMessage(content=str(observation), tool_call_id=tool_call["id"]))
        return {"messages": result}

    builder = StateGraph(DisruptionState)

    builder.add_node("identify_bookings", identify_bookings)
    builder.add_node("check_needs_escalation", check_needs_escalation)
    builder.add_node("notify_affected_guest", notify_affected_guest)
    builder.add_node("recommend_options", recommend_options)
    builder.add_node("execute_recommendation_tools", execute_recommendation_tools)
    builder.add_node("coordinate_booking", coordinate_booking)
    builder.add_node("generate_message", generate_message)
    builder.add_node("escalate_to_human", escalate_to_human)

    builder.add_edge(START, "identify_bookings")
    builder.add_edge("identify_bookings", "check_needs_escalation")
    builder.add_conditional_edges(
        "check_needs_escalation",
        route_after_escalation_check,
        ["notify_affected_guest", "escalate_to_human"],
    )
    builder.add_edge("notify_affected_guest", "recommend_options")

    # recommend_options is internally a small ReAct loop:
    # LLM decides whether to call a tool -> tool runs -> back to the LLM -> until no more tool calls
    builder.add_conditional_edges(
        "recommend_options",
        route_after_recommendation,
        ["execute_recommendation_tools", "generate_message", "escalate_to_human"],
    )
    builder.add_edge("execute_recommendation_tools", "recommend_options")

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
