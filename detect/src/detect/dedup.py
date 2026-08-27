"""Local, file-persisted de-dup for repeated detections of the same weather
event — same location + event type reported again within a cooldown window,
with no severity escalation, gets skipped instead of minted as a brand new
disruption_event. Without this, `run_demo.py` polling every N seconds (or a
person re-running it by hand) turns one ongoing storm into a dozen distinct
disruption ids downstream, each spawning its own case/notifications.

State lives on disk (not in-process memory) specifically so it survives
across separate `run_demo.py` invocations, not just within one long-running
process — that's the "反复运行" (repeated runs) case this exists for.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}


@dataclass
class _SeenEvent:
    severity: str
    reported_at: str  # ISO 8601


def _load(state_path: Path) -> dict[str, _SeenEvent]:
    if not state_path.exists():
        return {}
    try:
        raw = json.loads(state_path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    return {key: _SeenEvent(**value) for key, value in raw.items()}


def _save(state_path: Path, state: dict[str, _SeenEvent]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({key: asdict(value) for key, value in state.items()}, indent=2))


def should_report(
    state_path: Path, location_name: str, event_type: str, severity: str, cooldown_minutes: float, now: datetime
) -> bool:
    """True if this location+event_type hasn't been reported recently enough (or has gotten
    worse since), and records this report so the next call sees it. False means skip —
    same event, still within the cooldown window, not more severe than last time."""
    state = _load(state_path)
    key = f"{location_name}:{event_type}"
    prior = state.get(key)

    if prior is not None:
        elapsed_minutes = (now - datetime.fromisoformat(prior.reported_at)).total_seconds() / 60
        escalated = _SEVERITY_RANK.get(severity, 0) > _SEVERITY_RANK.get(prior.severity, 0)
        if elapsed_minutes < cooldown_minutes and not escalated:
            return False

    state[key] = _SeenEvent(severity=severity, reported_at=now.isoformat())
    _save(state_path, state)
    return True
