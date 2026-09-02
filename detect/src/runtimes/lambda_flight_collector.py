"""EventBridge Scheduler 定时触发的 Lambda 入口。

只负责"探测"：读机场 FIDS、判断某机场未来数小时是否大面积取消航班、有就把
原始信号推给 C# 后端的 POST /api/ingest/disruptions。候选预订匹配、建案、
分配协调员、发通知这些下游逻辑全部交给 C# 后端现有实现，这里不重复做。

航班 key 从 Secrets Manager 的 oag/api-key 读；值未填时本次直接跳过，不报错。
fetch_flight_status 目前仍打 AeroDataBox，将来换 OAG 只改 flight_status.py。
"""

from __future__ import annotations

import logging
from typing import Any

import requests

from src.adapters.config import cfg
from src.adapters.secrets import secret
from src.detect.flight_status import detect_flight_events
from src.detect.models import DisruptionEvent

logger = logging.getLogger(__name__)
# Lambda python3.12 运行时根 logger 默认 WARNING，不放开 INFO 则 CloudWatch 看不到 done 日志行
logging.getLogger().setLevel(logging.INFO)

INGEST_TIMEOUT_SECONDS = 10.0


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    api_key = (secret("oag/api-key") or "").strip()
    if not api_key:
        logger.warning('{"evt": "flight_collector.skipped", "reason": "oag/api-key is empty"}')
        return {"ingested": 0, "skipped": True}

    try:
        events = detect_flight_events(api_key=api_key)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status in (401, 403):
            # oag/api-key 当前对航班 FIDS 端点无效（占位值，或 endpoint 还没切到 OAG）。
            # 这不是"这次轮询失败"，是配置未就绪——跳过而不是让函数报错。
            logger.warning(
                '{"evt": "flight_collector.skipped", "reason": "provider auth failed (%s)"}', status
            )
            return {"ingested": 0, "skipped": True}
        raise

    for disruption_event in events:
        ingest_disruption(disruption_event)

    logger.info('{"evt": "flight_collector.done", "ingested": %d}', len(events))
    return {"ingested": len(events)}


def ingest_disruption(disruption_event: DisruptionEvent) -> None:
    """把探测到的一次机场级航班扰动写进 C# 后端，成为一条真实的 Disruption。"""
    payload = disruption_event.raw_payload
    region = payload.get("airport_iata") or "New Zealand"
    payload_body = {
        "type": disruption_event.source.value,
        "title": f"Mass flight cancellations at {region}",
        "region": region,
        "startAt": disruption_event.affects_window.start.isoformat(),
        "endAtOrWindow": disruption_event.affects_window.end.isoformat(),
        "rawSignalText": (
            f"{region} FIDS: {payload.get('cancelled_count')}/{payload.get('scheduled_count')} departures "
            f"cancelled (fraction={payload.get('cancelled_fraction')}), "
            f"severity={disruption_event.severity.value}, payload={payload}"
        ),
    }
    response = requests.post(
        f"{cfg('API_BASE_URL')}/api/ingest/disruptions",
        json=payload_body,
        headers={"X-Ingest-Key": secret("ingest/shared-key")},
        timeout=INGEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
