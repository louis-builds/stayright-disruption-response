"""资源名从 SSM Parameter Store 读——不许硬编码。见 docs/AWS_SDK_SPEC.md §4.1。"""

from __future__ import annotations

import os

from src.adapters.aws import client

STAGE = os.getenv("STAGE", "dev")
_cache: dict[str, str] = {}


def cfg(key: str) -> str:
    """读配置，进程内缓存（Lambda 每次冷启动重新读一次，同一次调用内不重复打 SSM）。

    环境变量 `key` 若已设置则直接用，不打 SSM——给没有 IAM instance role 的
    宿主（如 prod EC2，见 CLAUDE.md「新账户约束」IAM 权限边界）留的例外，
    值仍然只能来自 SSM 这个唯一真相来源，只是运行时改成人工/部署时注入。
    """
    if key not in _cache:
        env_value = os.environ.get(key)
        if env_value is not None:
            _cache[key] = env_value
        else:
            response = client("ssm").get_parameter(Name=f"/stayright/{STAGE}/{key}", WithDecryption=True)
            _cache[key] = response["Parameter"]["Value"]
    return _cache[key]
