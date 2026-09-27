"""MCP -> LangChain tool bridge.

langchain-mcp-adapters only supports mcp 1.x, and this project is on mcp 2.x, so this
glue is hand-rolled: connect to an MCP server (identify_server.py by default, run as a
stdio subprocess) and turn the tools it exposes via @mcp.tool() into LangChain tools.
"""

from __future__ import annotations

import os
import pathlib
import sys

from langchain_core.tools import StructuredTool
from mcp import Client, StdioServerParameters

_IDENTIFY_SERVER = pathlib.Path(__file__).resolve().parents[1] / "src" / "mcp_server" / "identify_server.py"
# sys.executable rather than "python" — otherwise the subprocess uses the system Python and
# can't import psycopg / pydantic, which only live in .venv
IDENTIFY_STDIO = StdioServerParameters(command=sys.executable, args=[str(_IDENTIFY_SERVER)])
BACKEND_MCP_URL = os.environ.get("BACKEND_MCP_URL", "http://localhost:5080/mcp")


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
