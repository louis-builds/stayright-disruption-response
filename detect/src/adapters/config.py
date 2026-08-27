"""资源名从 SSM Parameter Store 读——不许硬编码。见 docs/AWS_SDK_SPEC.md §4.1。"""

from __future__ import annotations

import os

from src.adapters.aws import client

STAGE = os.getenv("STAGE", "dev")
_cache: dict[str, str] = {}


def cfg(key: str) -> str:
    """读配置，进程内缓存（Lambda 每次冷启动重新读一次，同一次调用内不重复打 SSM）。"""
    if key not in _cache:
        response = client("ssm").get_parameter(Name=f"/stayright/{STAGE}/{key}", WithDecryption=True)
        _cache[key] = response["Parameter"]["Value"]
    return _cache[key]
