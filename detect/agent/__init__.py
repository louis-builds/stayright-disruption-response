"""LangGraph + MCP disruption-response agent.

Not under src/ (yet) — CLAUDE.md flags this package's placement relative to the
src/core|adapters|runtimes three-layer split as still to be confirmed with Zachary.
Hangs detect/ on the import path here (once, at package import time) so every submodule
below can do `from src.* import ...` without repeating the same sys.path hack.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from agent.graph import build_agent_graph, get_agent  # noqa: E402
from agent.state import DisruptionState, build_initial_state  # noqa: E402

__all__ = ["build_agent_graph", "get_agent", "DisruptionState", "build_initial_state"]
