"""密钥从 Secrets Manager 读——绝不进代码、绝不进 .env。见 docs/AWS_SDK_SPEC.md §4.3。"""

from __future__ import annotations

import os

from src.adapters.aws import client
from src.adapters.config import STAGE

_cache: dict[str, str] = {}


def secret(name: str) -> str:
    """`name` 形如 `ingest/shared-key`。环境变量 `INGEST_SHARED_KEY` 若已设置则直接用，
    不打 Secrets Manager——同 config.cfg() 的 IAM instance role 例外，见那边的说明。
    """
    if name not in _cache:
        env_key = name.upper().replace("/", "_").replace("-", "_")
        env_value = os.environ.get(env_key)
        if env_value is not None:
            _cache[name] = env_value
        else:
            response = client("secretsmanager").get_secret_value(SecretId=f"stayright/{STAGE}/{name}")
            _cache[name] = response["SecretString"]
    return _cache[name]
