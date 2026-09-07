# =========================================================
# StayRight NZ 中断处理 & 改签 Agent —— LangGraph 骨架
# 参考 LangGraph Graph API quickstart 的代码风格改写
# 工具函数先用占位符（stub），跑通图结构和可视化即可
# =========================================================

# agent/ 不在 src/ 下：把 detect/ 挂到 import 路径上，才能复用 src.identify / src.detect
# （与 src/mcp_server/identify_server.py 同一套做法）
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

# ---------- Step 1: 定义工具和模型 ----------
from dotenv import load_dotenv
load_dotenv()

from langchain.tools import tool
from langchain.chat_models import init_chat_model

model = init_chat_model(
    "gemini-2.5-flash",
    model_provider="google_genai",
    temperature=0
)


# 这两个工具给 rank_and_explain 节点用：
# 让 LLM 在"给客人推荐替代方案"时，能主动查真实数据，而不是自己编
@tool
def search_alternative_properties(
    city: str,
    check_in: str,
    check_out: str,
    budget_max: float,
    property_type: str = "any",
) -> list[dict]:
    """搜索满足条件的替代房源（占位实现，先返回假数据）。

    Args:
        city: 目标城市，例如 "Queenstown"
        check_in: 入住日期，格式 YYYY-MM-DD
        check_out: 离店日期，格式 YYYY-MM-DD
        budget_max: 每晚预算上限（NZD）
        property_type: 房型偏好，例如 "hotel"、"holiday_park"、"any"
    """
    # TODO: 换成真实的房源搜索 API / 数据库查询
    return [
        {"property_id": "P001", "name": "Lakeview Motel", "price_per_night": 189},
        {"property_id": "P002", "name": "Queenstown Holiday Park", "price_per_night": 129},
    ]


@tool
def get_cancellation_policy(property_id: str) -> str:
    """查询某个房源真实的取消/改签政策原文（占位实现）。

    Args:
        property_id: 房源 ID
    """
    # TODO: 换成真实的政策数据库/知识库检索（RAG），
    # 绝不能让 LLM 凭记忆编造政策条款
    return "Free cancellation up to 24 hours before check-in. After that, one night's charge applies."


tools = [search_alternative_properties, get_cancellation_policy]
tools_by_name = {tool.name: tool for tool in tools}
model_with_tools = model.bind_tools(tools)


# ---------- Step 2: 定义 State ----------
from langchain.messages import AnyMessage
from typing_extensions import TypedDict, Annotated, Optional, List, Dict, Any
import operator


class DisruptionState(TypedDict):
    disruption_event: Dict[str, Any]
    affected_bookings: Optional[List[Dict[str, Any]]]
    needs_escalation: Optional[bool]
    escalation_reason: Optional[str]
    ranked_options: Optional[List[Dict[str, Any]]]
    ranking_confidence: Optional[float]
    booking_success: Optional[bool]
    final_message: Optional[str]
    messages: Annotated[list[AnyMessage], operator.add]
    llm_calls: int


# ---------- Step 3: 定义各节点 ----------
from langchain.messages import SystemMessage, ToolMessage

from src.detect.models import DisruptionEvent
from src.identify.db import get_connection
from src.identify.matcher import find_affected_bookings


def _serialise_booking(row: dict) -> dict:
    """matcher 返回的行里 booking_id/guest_id 是 UUID、check_in/check_out 是 date，
    state 要能过 checkpointer 序列化、也要能塞进给 LLM 的 prompt —— 统一转成字符串。
    """
    return {
        "booking_id": str(row["booking_id"]),
        "guest_id": str(row["guest_id"]),
        "hotel_id": str(row["hotel_id"]),
        "hotel_name": row["hotel_name"],
        "check_in": row["check_in"].isoformat(),
        "check_out": row["check_out"].isoformat(),
        "lat": row["lat"],
        "lng": row["lng"],
    }


def identify_bookings(state: DisruptionState, config: dict | None = None) -> dict:
    """按 DisruptionEvent 的地理 + 时间范围查受影响订单（复用 src/identify，不走 LLM）。

    连接工厂从 config["configurable"]["connect"] 取，默认 src.identify.db.get_connection；
    测试里传一个返回 mock 连接的 callable 就能脱库跑（见 tests/test_identify.py 的 _mock_conn）。
    """
    event = DisruptionEvent.model_validate(state["disruption_event"])
    connect = ((config or {}).get("configurable") or {}).get("connect", get_connection)

    conn = connect()
    try:
        rows = find_affected_bookings(event, conn)
    finally:
        conn.close()

    return {"affected_bookings": [_serialise_booking(r) for r in rows]}


def check_case_type(state: DisruptionState) -> dict:
    """判断是否群体订单 / VIP / 纠纷，需要提前转人工（规则判断，不走 LLM）"""
    # TODO: 换成真实的规则判断逻辑
    return {"needs_escalation": False, "escalation_reason": None}

def notify_affected_guest(state: DisruptionState) -> dict:
    """发邮件通知受影响的客户，告诉他们行程可能受影响（不发具体方案）"""
    # TODO：邮件
    return {}


def rank_and_explain(state: DisruptionState) -> dict:
    """LLM 节点：结合客人偏好，调用工具搜索替代房源 + 查真实政策，
    生成排序后的推荐方案和解释文案"""
    return {
        "messages": [
            model_with_tools.invoke(
                [
                    SystemMessage(
                        content=(
                            "You are a travel disruption assistant for StayRight NZ. "
                            "Use the tools to search real alternative properties and "
                            "check their real cancellation policy before recommending "
                            "anything to the guest. Never invent policy terms."
                        )
                    )
                ]
                + state["messages"]
            )
        ],
        "llm_calls": state.get("llm_calls", 0) + 1,
    }


def rank_tool_node(state: DisruptionState) -> dict:
    """执行 rank_and_explain 决定要调用的工具（搜房源 / 查政策）"""
    result = []
    for tool_call in state["messages"][-1].tool_calls:
        tool = tools_by_name[tool_call["name"]]
        observation = tool.invoke(tool_call["args"])
        result.append(ToolMessage(content=str(observation), tool_call_id=tool_call["id"]))
    return {"messages": result}


def generate_message(state: DisruptionState) -> dict:
    """LLM 节点：生成发给客人的最终通知文案（不需要工具，直接总结）"""
    return {
        "final_message": model.invoke(
            [
                SystemMessage(content="Write a warm, clear message to the guest summarising the rebooking outcome.")
            ]
            + state["messages"]
        ).content
    }


def coordinate_booking(state: DisruptionState) -> dict:
    """执行取消原订单 + 预定新房源（多步骤协调，代码执行）"""
    # TODO: 换成真实的取消 + 预定 API 调用，并处理失败重试
    return {"booking_success": True}


def escalate_to_human(state: DisruptionState) -> dict:
    """转人工，带上完整上下文"""
    return {"final_message": "Escalated to human support with full context."}


# ---------- Step 4: 定义条件边 ----------
from typing import Literal
from langgraph.graph import StateGraph, START, END


def route_after_case_check(state: DisruptionState) -> Literal["notify_affected_guest", "escalate_to_human"]:
    if state.get("needs_escalation"):
        return "escalate_to_human"
    return "notify_affected_guest"


def route_after_rank(state: DisruptionState) -> Literal["rank_tool_node", "generate_message", "escalate_to_human"]:
    last_message = state["messages"][-1]
    # LLM 还想调用工具（搜房源/查政策），回到 tool node
    if last_message.tool_calls:
        return "rank_tool_node"
    # LLM 已经给出最终推荐，且置信度不够，转人工
    if (state.get("ranking_confidence") or 1.0) < 0.6:
        return "escalate_to_human"
    # 先给客人发方案说明，再去协调实际订房
    return "generate_message"


# ---------- Step 5: 构建图 ----------
agent_builder = StateGraph(DisruptionState)

agent_builder.add_node("identify_bookings", identify_bookings)
agent_builder.add_node("check_case_type", check_case_type)
agent_builder.add_node("notify_affected_guest", notify_affected_guest)
agent_builder.add_node("rank_and_explain", rank_and_explain)
agent_builder.add_node("rank_tool_node", rank_tool_node)
agent_builder.add_node("coordinate_booking", coordinate_booking)
agent_builder.add_node("generate_message", generate_message)
agent_builder.add_node("escalate_to_human", escalate_to_human)

agent_builder.add_edge(START, "identify_bookings")
agent_builder.add_edge("identify_bookings", "check_case_type")

agent_builder.add_conditional_edges(
    "check_case_type",
    route_after_case_check,
    ["notify_affected_guest", "escalate_to_human"],
)
agent_builder.add_edge("notify_affected_guest", "rank_and_explain")

# rank_and_explain 内部是一个小型 ReAct 循环：
# LLM 决定要不要调用工具 -> 工具执行 -> 回到 LLM -> 直到不再调用工具
agent_builder.add_conditional_edges(
    "rank_and_explain",
    route_after_rank,
    ["rank_tool_node", "generate_message", "escalate_to_human"],
)
agent_builder.add_edge("rank_tool_node", "rank_and_explain")

# 先把方案说明发给客人，再去协调实际的取消 + 订新房
agent_builder.add_edge("generate_message", "coordinate_booking")

agent_builder.add_edge("coordinate_booking", END)
agent_builder.add_edge("escalate_to_human", END)

# 编译
agent = agent_builder.compile()

# ---------- Step 6: 画图 ----------
try:
    png_bytes = agent.get_graph(xray=True).draw_mermaid_png()
    with open("kakapa_graph.png", "wb") as f:
        f.write(png_bytes)
    print("Saved graph diagram to kakapa_graph.png")
except Exception as e:
    print(f"Could not render graph diagram: {e}")

# ---------- Step 7: 试跑一次（占位输入） ----------
from langchain.messages import HumanMessage

initial_state = {
    "disruption_event": {
        "type": "severe_weather",
        "region": "Queenstown",
        "affected_dates": ["2026-08-10", "2026-08-12"],
    },
    "messages": [
        HumanMessage(
            content="Queenstown storm has grounded flights on 10-12 Aug. "
                    "Find alternative accommodation options for affected guests."
        )
    ],
}

result = agent.invoke(initial_state)
for m in result["messages"]:
    m.pretty_print()