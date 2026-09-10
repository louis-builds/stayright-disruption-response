# =========================================================
# StayRight NZ 中断处理 & 改签 Agent —— LangGraph 骨架
# 工具走 MCP：identify_server.py 暴露的 tool 由 agent/mcp_tools.py 转成
# LangChain 工具后接进图里。非 LLM 的编排节点仍是占位 stub。
# =========================================================

# agent/ 不在 src/ 下：把 detect/ 挂到 import 路径上，才能复用 src.* 和 agent.mcp_tools
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# ---------- Step 1: 模型 ----------
from dotenv import load_dotenv

load_dotenv()

from functools import lru_cache

from langchain.chat_models import init_chat_model


# 延迟初始化：init_chat_model 在构造时就要 GEMINI_API_KEY，放模块级会让「只想 import
# 这个模块跑 identify / 路由测试」的场景也被逼着配 key。真正用到 LLM 的节点再取。
@lru_cache(maxsize=1)
def get_model():
    return init_chat_model("gemini-2.5-flash", model_provider="google_genai", temperature=0)


# ---------- MCP 工具接入 ----------
# langchain-mcp-adapters 只支持 mcp 1.x，本项目用的是 mcp 2.x，所以这几十行胶水自己维护：
# 连上 identify_server.py（stdio 子进程），把它 @mcp.tool() 暴露的函数转成 LangChain 工具。
from langchain_core.tools import StructuredTool
from mcp import Client, StdioServerParameters

_IDENTIFY_SERVER = pathlib.Path(__file__).resolve().parents[1] / "src" / "mcp_server" / "identify_server.py"
# 用 sys.executable 而不是 "python"，否则子进程用系统 Python，装在 .venv 里的 psycopg / pydantic import 不到
IDENTIFY_STDIO = StdioServerParameters(command=sys.executable, args=[str(_IDENTIFY_SERVER)])


def _unwrap(result):
    """取出工具返回值。MCPServer 给非 object 的返回类型（如 list[dict]）会套一层
    {"result": ...} 以满足「structured content 必须是 object」，这里剥掉。"""
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
    """连上 MCP server，把它暴露的工具全部转成 LangChain 工具。

    target 默认是「起 identify_server.py 子进程」；也可以直接传一个进程内的 MCPServer
    实例（测试用，免子进程开销）。每次调用工具会重新建一次连接 —— 当前量级够用。
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


# ---------- Step 3: 节点 ----------
import logging

from langchain.messages import HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from src.detect.models import DisruptionEvent

log = logging.getLogger("kakapo.agent")


async def identify_bookings(state: DisruptionState, config: RunnableConfig | None = None) -> dict:
    """走 MCP 调 identify_server 的 matched_bookings 工具查受影响订单（不走 LLM）。

    连接目标默认是「起 identify_server.py 子进程」（IDENTIFY_STDIO）；测试里可通过
    config["configurable"]["identify_server"] 传一个进程内的 MCPServer 实例脱库跑。
    MCP 边界已经把 UUID / date 序列化成字符串，这里拿到就是 JSON-safe 的 dict。
    """
    server = ((config or {}).get("configurable") or {}).get("identify_server", IDENTIFY_STDIO)
    log.info("identify_bookings: 经 MCP 调 matched_bookings（server=%s）", getattr(server, "args", server))
    tools = await load_mcp_tools(server)
    matched = next(tool for tool in tools if tool.name == "matched_bookings")
    rows = await matched.ainvoke({"disruption_event": state["disruption_event"]})
    log.info("identify_bookings: MCP 返回 %d 条受影响订单", len(rows))
    return {"affected_bookings": list(rows)}


def check_case_type(state: DisruptionState) -> dict:
    """判断是否群体订单 / VIP / 纠纷，需要提前转人工（规则判断，不走 LLM）"""
    # TODO: 换成真实的规则判断逻辑
    return {"needs_escalation": False, "escalation_reason": None}


def notify_affected_guest(state: DisruptionState) -> dict:
    """发邮件通知受影响的客户，告诉他们行程可能受影响（不发具体方案）"""
    # TODO: 邮件
    return {}


def generate_message(state: DisruptionState) -> dict:
    """LLM 节点：生成发给客人的最终通知文案（不需要工具，直接总结）。

    gemini-2.5-flash 在这个节点上实测有相当高概率返回 finish_reason=STOP 但
    output_tokens=0 的空结果，原因不明。重试几次基本能拿到非空结果；真的一直空，
    退到一句兜底文案，不能让客人收到空消息。
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
    """执行取消原订单 + 预定新房源（多步骤协调，代码执行）"""
    # TODO: 换成真实的取消 + 预定 API 调用，并处理失败重试
    return {"booking_success": True}


def escalate_to_human(state: DisruptionState) -> dict:
    """转人工，带上完整上下文"""
    return {"final_message": "Escalated to human support with full context."}


# ---------- Step 4: 条件边 ----------
from typing import Literal

from langgraph.graph import END, START, StateGraph


def route_after_case_check(state: DisruptionState) -> Literal["notify_affected_guest", "escalate_to_human"]:
    if state.get("needs_escalation"):
        return "escalate_to_human"
    return "notify_affected_guest"


def route_after_rank(state: DisruptionState) -> Literal["rank_tool_node", "generate_message", "escalate_to_human"]:
    last_message = state["messages"][-1]
    # LLM 还想调用工具（搜房源/查政策），回到 tool node
    if getattr(last_message, "tool_calls", None):
        return "rank_tool_node"
    # LLM 已经给出最终推荐，且置信度不够，转人工
    if (state.get("ranking_confidence") or 1.0) < 0.6:
        return "escalate_to_human"
    return "generate_message"


# ---------- Step 5: 构建图 ----------
_agent = None


async def build_agent_graph() -> "StateGraph":
    """装配（未编译的）图并返回 builder。MCP 工具要 await 才能拿到，所以是 async。

    调用方自己 .compile()，可按需传 checkpointer / interrupt_after —— scripts/
    run_agent_pipeline.py 就靠 interrupt_after 让图跑到 identify_bookings 就停。
    """
    tools = await load_mcp_tools(IDENTIFY_STDIO)
    tools_by_name = {tool.name: tool for tool in tools}
    model_with_tools = get_model().bind_tools(tools)

    async def rank_and_explain(state: DisruptionState) -> dict:
        """LLM 节点：调 MCP 工具搜替代房源 + 查真实政策，生成排序后的推荐和解释文案。"""
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
            # 一次工具都没调过 = LLM 凭空回答，没有真实房源/政策数据兜底，压低置信度让
            # route_after_rank 转人工。
            used_real_data = any(isinstance(m, ToolMessage) for m in state["messages"])
            result["ranking_confidence"] = 0.9 if used_real_data else 0.3
        return result

    async def rank_tool_node(state: DisruptionState) -> dict:
        """执行 rank_and_explain 决定要调用的 MCP 工具。MCP 工具是 async，用 ainvoke。"""
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

    # rank_and_explain 内部是一个小型 ReAct 循环：
    # LLM 决定要不要调用工具 -> 工具执行 -> 回到 LLM -> 直到不再调用工具
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
    """默认编译（无 checkpointer / interrupt）并缓存，供直接 invoke 整张图。"""
    global _agent
    if _agent is None:
        _agent = (await build_agent_graph()).compile()
    return _agent


# ---------- 供采集管线调用的入口 ----------
from datetime import datetime, timedelta, timezone


def build_initial_state(event: DisruptionEvent) -> DisruptionState:
    """把一个 DisruptionEvent（探测器产出）转成图的初始 state。"""
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


# 直接跑本模块时用的样例事件：Queenstown Lakeview Hotel 坐标，窗口 now..+30d
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
