"""boto3 client 工厂——全项目唯一创建 boto3 client 的地方。

见 docs/AWS_SDK_SPEC.md §3。任何地方需要 AWS 客户端时用 client("s3")，
不要直接写 boto3.client("s3")。
"""

from __future__ import annotations

import boto3
from botocore.config import Config

REGION = "ap-southeast-2"

_STD = Config(
    region_name=REGION, connect_timeout=5, read_timeout=30,
    retries={"max_attempts": 3, "mode": "standard"},
)
# 大模型生成慢，单独给更长的读超时。
_LLM = Config(
    region_name=REGION, connect_timeout=5, read_timeout=120,
    retries={"max_attempts": 3, "mode": "standard"},
)

_clients: dict[str, object] = {}


def client(service: str):
    if service not in _clients:
        config = _LLM if service == "bedrock-runtime" else _STD
        _clients[service] = boto3.client(service, config=config)
    return _clients[service]
