import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from mcp.server.mcpserver import MCPServer
from src.identify.matcher import find_affected_bookings
from src.identify.db import get_connection
from src.detect.models import DisruptionEvent

mcp = MCPServer("kakapo")

@mcp.tool()
def matched_bookings(disruption_event:dict) -> list[dict]:
    """根据 DisruptionEvent 的地理和时间范围，返回受影响的订单列表。"""
    event = DisruptionEvent.model_validate(disruption_event)
    with get_connection() as conn:
        return find_affected_bookings(event, conn)

# 这两个工具给 rank_and_explain 节点用：
# 让 LLM 在"给客人推荐替代方案"时，能主动查真实数据，而不是自己编
@mcp.tool
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


@mcp.tool
def get_cancellation_policy(property_id: str) -> str:
    """查询某个房源真实的取消/改签政策原文（占位实现）。

    Args:
        property_id: 房源 ID
    """
    # TODO: 换成真实的政策数据库/知识库检索（RAG），
    # 绝不能让 LLM 凭记忆编造政策条款
    return "Free cancellation up to 24 hours before check-in. After that, one night's charge applies."


if __name__ == "__main__":
    mcp.run(transport="stdio")