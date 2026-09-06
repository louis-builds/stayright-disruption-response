"""EventBridge Scheduler 定时触发的 Lambda 入口。

只负责"探测"：读 GeoNet 的火山警戒级别、判断有没有区域级扰动、有就把原始
信号推给 C# 后端的 POST /api/ingest/disruptions。候选预订匹配、建案、分配
协调员、发通知这些下游逻辑全部交给 C# 后端现有实现，这里不重复做。
"""

from __future__ import annotations

import logging
from typing import Any

import requests

from src.adapters.config import cfg
from src.adapters.secrets import secret
from src.detect.geonet_volcano import detect_volcano_events
from src.detect.models import DisruptionEvent

logger = logging.getLogger(__name__)
# Lambda python3.12 运行时根 logger 默认 WARNING，不放开 INFO 则 CloudWatch 看不到 done 日志行
logging.getLogger().setLevel(logging.INFO)

INGEST_TIMEOUT_SECONDS = 10.0


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    events = detect_volcano_events()
    for disruption_event in events:
        ingest_disruption(disruption_event)

    logger.info('{"evt": "volcano_collector.done", "ingested": %d}', len(events))
    return {"ingested": len(events)}


def ingest_disruption(disruption_event: DisruptionEvent) -> None:
    """把探测到的一次火山扰动写进 C# 后端，成为一条真实的 Disruption。"""
    payload = disruption_event.raw_payload
    region = payload.get("volcano_title") or "New Zealand"
    payload_body = {
        "type": disruption_event.source.value,
        "title": f"Volcanic activity near {region} (VAL {payload.get('alert_level')})",
        "region": region,
        "startAt": disruption_event.affects_window.start.isoformat(),
        "endAtOrWindow": disruption_event.affects_window.end.isoformat(),
        "rawSignalText": (
            f"GeoNet VAL {payload.get('alert_level')} / aviation {payload.get('aviation_colour_code')} "
            f"near {region}: severity={disruption_event.severity.value}, "
            f"activity={payload.get('activity')}, payload={payload}"
        ),
    }
    response = requests.post(
        f"{cfg('API_BASE_URL')}/api/ingest/disruptions",
        json=payload_body,
        headers={"X-Ingest-Key": secret("ingest/shared-key")},
        timeout=INGEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
