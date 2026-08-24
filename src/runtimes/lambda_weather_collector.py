"""EventBridge Scheduler 定时触发的 Lambda 入口。

只负责"探测"：轮询天气、判断有没有风险、有风险就把原始信号推给 C# 后端
的 POST /api/ingest/disruptions。候选预订匹配、建案、分配协调员、发通知
这些下游逻辑全部交给 C# 后端现有实现，这里不重复做。
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import requests

from src.adapters.config import cfg
from src.adapters.secrets import secret
from src.detect.open_meteo import (
    DEFAULT_LOCATIONS,
    Classification,
    Location,
    build_disruption_event,
    classify,
    fetch_weather,
)
from src.detect.models import DisruptionEvent

logger = logging.getLogger(__name__)

INGEST_TIMEOUT_SECONDS = 10.0


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    ingested = 0

    for location in DEFAULT_LOCATIONS:
        raw_payload = fetch_weather(location.lat, location.lng)
        classification = classify(raw_payload)
        if not classification.is_risky:
            continue

        disruption_event = build_disruption_event(location, raw_payload, classification, detected_at=now)
        ingest_disruption(disruption_event, location, classification)
        ingested += 1

    logger.info('{"evt": "weather_collector.done", "ingested": %d}', ingested)
    return {"ingested": ingested}


def ingest_disruption(disruption_event: DisruptionEvent, location: Location, classification: Classification) -> None:
    """把探测到的一次风险事件写进 C# 后端，成为一条真实的 Disruption。"""
    payload = {
        "type": disruption_event.source.value,
        "title": f"{classification.event_type.replace('_', ' ').title()} near {location.name}",
        "region": location.name,
        "startAt": disruption_event.affects_window.start.isoformat(),
        "endAtOrWindow": disruption_event.affects_window.end.isoformat(),
        "rawSignalText": (
            f"Open-Meteo {classification.event_type} reading near {location.name}: "
            f"severity={classification.severity.value}, payload={disruption_event.raw_payload}"
        ),
    }
    response = requests.post(
        f"{cfg('API_BASE_URL')}/api/ingest/disruptions",
        json=payload,
        headers={"X-Ingest-Key": secret("ingest/shared-key")},
        timeout=INGEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
