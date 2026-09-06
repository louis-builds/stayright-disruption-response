"""EventBridge Scheduler 定时触发的 Lambda 入口。

只负责"探测"：读 NZTA 的路网事件、判断有没有把某个镇整体切断的国道封闭、
有就把原始信号推给 C# 后端的 POST /api/ingest/disruptions。候选预订匹配、
建案、分配协调员、发通知这些下游逻辑全部交给 C# 后端现有实现，这里不重复做。
"""

from __future__ import annotations

import logging
from typing import Any

import requests

from src.adapters.config import cfg
from src.adapters.secrets import secret
from src.detect.models import DisruptionEvent
from src.detect.nzta_road import detect_road_events

logger = logging.getLogger(__name__)
# Lambda python3.12 运行时根 logger 默认 WARNING，不放开 INFO 则 CloudWatch 看不到 done 日志行
logging.getLogger().setLevel(logging.INFO)

INGEST_TIMEOUT_SECONDS = 10.0


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    events = detect_road_events()
    for disruption_event in events:
        ingest_disruption(disruption_event)

    logger.info('{"evt": "road_collector.done", "ingested": %d}', len(events))
    return {"ingested": len(events)}


def ingest_disruption(disruption_event: DisruptionEvent) -> None:
    """把探测到的一次国道封闭写进 C# 后端，成为一条真实的 Disruption。"""
    payload = disruption_event.raw_payload
    road_number = payload.get("road_number") or "SH?"
    region = payload.get("sole_access_route") or payload.get("location_area") or road_number
    payload_body = {
        "type": disruption_event.source.value,
        "title": f"{road_number} closed — {region}",
        "region": region,
        "startAt": disruption_event.affects_window.start.isoformat(),
        "endAtOrWindow": disruption_event.affects_window.end.isoformat(),
        "rawSignalText": (
            f"NZTA {road_number} {payload.get('impact')} near {region}: "
            f"severity={disruption_event.severity.value}, "
            f"detour_available={payload.get('detour_available')}, payload={payload}"
        ),
    }
    response = requests.post(
        f"{cfg('API_BASE_URL')}/api/ingest/disruptions",
        json=payload_body,
        headers={"X-Ingest-Key": secret("ingest/shared-key")},
        timeout=INGEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
