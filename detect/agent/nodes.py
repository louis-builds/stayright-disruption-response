"""Node and routing functions for the disruption-response graph.

recommend_options / execute_recommendation_tools are the exception — they live in
graph.py instead, because they close over the MCP tool list fetched once at
graph-assembly time (needed to bind tools to the model). Everything here is
self-contained and independently testable without a live LLM or database connection.
"""

import logging
from functools import lru_cache
from typing import Literal

from dotenv import load_dotenv
from langchain.chat_models import init_chat_model
from langchain.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from agent.mcp_client import IDENTIFY_STDIO, load_mcp_tools
from agent.state import DisruptionState

load_dotenv()

log = logging.getLogger("kakapo.agent")


# Lazy init: init_chat_model needs GEMINI_API_KEY at construction time, so building it at
# module level would force a key even for callers who just want to import this module to
# run identify/routing tests. Only fetch it from the node that actually needs the LLM.
@lru_cache(maxsize=1)
def get_model():
    # gemini-2.5-flash's free tier is 20 requests/day; flash-lite's free tier is much
    # higher (250/day) -- swap back once billing is on or the free tier changes.
    return init_chat_model("gemini-3.5-flash-lite", model_provider="google_genai", temperature=0)


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


def check_needs_escalation(state: DisruptionState) -> dict:
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
    # The conversation history's last turn is recommend_options's final AI reply, but
    # gemini-3.5-flash-lite rejects a request that ends on an assistant turn ("prefilling")
    # -- append a trailing human turn so the request always ends on a user message.
    prompt = (
        [SystemMessage(content="Write a warm, clear message to the guest summarising the rebooking outcome.")]
        + state["messages"]
        + [HumanMessage(content="Now write that message to the guest.")]
    )

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


def route_after_escalation_check(state: DisruptionState) -> Literal["notify_affected_guest", "escalate_to_human"]:
    if state.get("needs_escalation"):
        return "escalate_to_human"
    return "notify_affected_guest"


def route_after_recommendation(state: DisruptionState) -> Literal["execute_recommendation_tools", "generate_message", "escalate_to_human"]:
    last_message = state["messages"][-1]
    # The LLM still wants to call a tool (search properties / check policy) — back to the tool node
    if getattr(last_message, "tool_calls", None):
        return "execute_recommendation_tools"
    # The LLM has given its final recommendation but confidence is too low — escalate
    if (state.get("ranking_confidence") or 1.0) < 0.6:
        return "escalate_to_human"
    return "generate_message"
