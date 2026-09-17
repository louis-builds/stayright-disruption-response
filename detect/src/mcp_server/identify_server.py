import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
import logging

from mcp.server.mcpserver import MCPServer
from src.identify.matcher import find_affected_bookings
from src.identify.db import get_connection
from src.detect.models import DisruptionEvent

# stdout belongs to MCP's JSON-RPC channel; logs can only go to stderr (logging's default anyway)
logging.basicConfig(level=logging.INFO, stream=sys.stderr, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("kakapo.identify_server")

mcp = MCPServer("kakapo")


def _serialise_booking(row: dict) -> dict:
    """The rows matcher returns have booking_id/guest_id/hotel_id as UUID and check_in/
    check_out as date — none of which survive MCP's JSON serialisation, so convert them all
    to strings. Doing this on the server side means every MCP client (LangGraph / Claude
    Desktop / C#) gets back a JSON-safe dict."""
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


@mcp.tool()
def matched_bookings(disruption_event: dict) -> list[dict]:
    """Return the bookings affected by a DisruptionEvent's geo and time range."""
    log.info("MCP tool invoked: matched_bookings")
    event = DisruptionEvent.model_validate(disruption_event)
    with get_connection() as conn:
        rows = find_affected_bookings(event, conn)
    log.info("MCP tool matched_bookings -> %d booking(s) matched", len(rows))
    return [_serialise_booking(row) for row in rows]

@mcp.tool()
def search_alternative_properties(
    city: str,
    check_in: str,
    check_out: str,
    budget_max: float,
    property_type: str = "any",
) -> list[dict]:
    """Search for alternative properties matching the given criteria (placeholder — returns canned data).

    Args:
        city: target city, e.g. "Queenstown"
        check_in: check-in date, format YYYY-MM-DD
        check_out: check-out date, format YYYY-MM-DD
        budget_max: max nightly budget (NZD)
        property_type: property type preference, e.g. "hotel", "holiday_park", "any"
    """
    # TODO: replace with a real property search API / database query
    return [
        {"property_id": "P001", "name": "Lakeview Motel", "price_per_night": 189},
        {"property_id": "P002", "name": "Queenstown Holiday Park", "price_per_night": 129},
    ]


@mcp.tool()
def get_cancellation_policy(property_id: str) -> str:
    """Look up a property's real cancellation/rebooking policy text (placeholder implementation).

    Args:
        property_id: property ID
    """
    # TODO: replace with real policy database/knowledge-base retrieval (RAG) —
    # never let the LLM invent policy terms from memory
    return "Free cancellation up to 24 hours before check-in. After that, one night's charge applies."


if __name__ == "__main__":
    mcp.run(transport="stdio")