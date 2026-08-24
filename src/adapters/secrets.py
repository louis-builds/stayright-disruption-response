"""密钥从 Secrets Manager 读——绝不进代码、绝不进 .env。见 docs/AWS_SDK_SPEC.md §4.3。"""

from __future__ import annotations

from src.adapters.aws import client
from src.adapters.config import STAGE

_cache: dict[str, str] = {}


def secret(name: str) -> str:
    if name not in _cache:
        response = client("secretsmanager").get_secret_value(SecretId=f"stayright/{STAGE}/{name}")
        _cache[name] = response["SecretString"]
    return _cache[name]
