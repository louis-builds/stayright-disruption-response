import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from mcp.server.mcpserver import MCPServer
from src.identify.matcher import find_affected_bookings
from src.identify.db import get_connection
from src.detect.models import DisruptionEvent

mcp = MCPServer("kakapo-identify")

@mcp.tool()
def matched_bookings(disruption_event:dict) -> list[dict]:
    """根据 DisruptionEvent 的地理和时间范围，返回受影响的订单列表。"""
    event = DisruptionEvent.model_validate(disruption_event)
    with get_connection() as conn:
        return find_affected_bookings(event, conn)

if __name__ == "__main__":
    mcp.run(transport="stdio")