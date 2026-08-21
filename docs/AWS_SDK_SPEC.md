# StayRight NZ · AWS SDK 使用规范（AI 提示词上下文）

> **用法**：开发 StayRight NZ 时，把**整份文档**粘贴进 AI 会话开头，然后再描述你要写的功能。
> 本文件定义了本项目与 AWS 交互的唯一正确写法。**AI 生成的代码若与本文档冲突，以本文档为准。**
>
> 版本 **v1.1** · 2026-08-21 ｜ 上一版 v1.0（2026-08-20）
> **v1.1 变更**：AWS 环境已全部搭好并通过冒烟验收 → §1 状态表从"待开通"改为"已就绪"；
> §4.2 补当前实际值；§4.3 修正 Secret 名（`oag/subscription-key` → `oag/api-key`）；
> §5.5 Bedrock 增加**推理配置文件**与**数据驻留**两条硬规则；§5.10 补数据库实际形态；
> 新增 §11 本地开发环境准备、§12 部署方式（你不需要手动部署）。

---

## 0. 你需要知道的三件事（30 秒版）

1. **你不需要 AWS 账号，也不需要任何密钥。** 本地开发设 `STAYRIGHT_LOCAL=1` 就能跑通全流程（§9、§11）。
2. **资源名绝不硬编码**，一律 `cfg("KEY")` 从 SSM 读（§4）。这条规则让换 AWS 账户时代码零改动。
3. **`src/core/` 是纯函数层**，里面不许出现 `boto3`、`os.environ`、`datetime.now()`。CI 会自动拦截。

---

## 1. 环境事实（AI 必须先知道这些）

| 项 | 值 |
|---|---|
| 云区域 | **`ap-southeast-2`（悉尼）** —— 永远是这个，不要写别的区域 |
| 语言 | Python 3.12 |
| SDK | `boto3`（唯一 AWS SDK） |
| 数据库 | PostgreSQL **16.15** + PostGIS **3.4.3** + pgvector **0.8.6**，驱动用 `psycopg` v3 |
| 大模型 | Bedrock `converse` API；模型 ID 从 SSM 读，当前是 Claude Haiku 4.5（`au.` 前缀） |
| 凭证 | **不写任何 AccessKey**。线上靠 EC2/Lambda 的 IAM 角色，本地靠 `STAYRIGHT_LOCAL=1` |
| 运行时 | ⑤⑥⑦ 层收在一台 EC2 的单个 Python 进程（模块化单体，ADR #18）；4 个采集器 + 1 个回调是 Lambda |
| IaC | 非代码资源由脚本 `infra/bootstrap.sh` 建；5 个 Lambda 走 SAM（开发者不写模板） |

### ✅ 当前状态：AWS 环境已就绪（2026-08-21 冒烟验收通过）

| 服务 | 状态 | 备注 |
|---|:-:|---|
| SSM Parameter Store | ✅ 12 个参数已写入 | 见 §4.2 |
| Secrets Manager | ✅ 3 个已建 | `oag/api-key` 值待填 |
| S3 ×2 | ✅ | 原文归档 / 结果站（兼制品桶） |
| SQS ×3 | ✅ | 主 FIFO + DLQ + 回调标准队列 |
| EventBridge 自定义总线 | ✅ | |
| Bedrock | ✅ 已开通并实测 | 走**推理配置文件**，见 §5.5 |
| SES | ✅ 发件人已验证 | ⚠️ **沙箱模式**，收件人也必须验证，配额 200/24h |
| EC2 + PostGIS + pgvector | ✅ 实测通过 | ⚠️ **按需开停**，不常开 |
| Lambda ×5 | ⏳ 待部署 | `FUNCTION_URL` 仍是占位符 |

> ⚠️ **EC2 是按需开停的**（省抵扣金）。你连不上数据库时，先问 Zachary 机器开着没有。
> 👉 即便如此，**开发不依赖 AWS 是否在线**——用 §9 的本地假实现。

---

## 2. 六条铁律

1. **绝不硬编码任何资源名**（桶名、队列 URL、总线名、模型 ID、ARN）→ 一律从 SSM 读，见 §4。
   *这条规则已经兑现四次红利：手建/模板建等价、AWS 未开通也能开发、换账户零改动、CI 无需知道账户信息。*
2. **绝不写 AccessKey / SecretKey**，用默认凭证链。
3. **client 在模块级创建一次**，不要在函数里 `boto3.client(...)`（每次创建要几百毫秒）。
4. **绝不自己写重试循环**，用 `botocore.config.Config` 统一配置。
5. **绝不 `try/except: pass`** —— 失败必须抛出去，SQS 才知道要重投。
6. **所有时间带时区**：`datetime.now(timezone.utc)`，永远不用裸 `datetime.now()`。

### 分层边界（CI 强制，违反直接构建失败）

```
src/core/       纯函数。禁止 boto3 / os.environ / datetime.now()
                所有外部依赖从参数传进来，所有时间从参数传进来
src/adapters/   与外部世界打交道的唯一入口（AWS、Postgres、HTTP）
src/runtimes/   进程外壳（EC2 worker、Lambda handler）
```

> 拿不准某段代码该放哪层就问 Zachary，**不要自己猜**——这条边界是整个架构可逆性的唯一保险。

---

## 3. 统一的 client 工厂（所有 AWS 调用都从这里拿 client）

```python
# adapters/aws.py —— 全项目唯一创建 boto3 client 的地方
import boto3
from botocore.config import Config

REGION = "ap-southeast-2"

_STD = Config(region_name=REGION, connect_timeout=5, read_timeout=30,
              retries={"max_attempts": 3, "mode": "standard"})
# 大模型生成慢，单独给更长的读超时
_LLM = Config(region_name=REGION, connect_timeout=5, read_timeout=120,
              retries={"max_attempts": 3, "mode": "standard"})

_clients = {}

def client(service: str):
    if service not in _clients:
        cfg = _LLM if service == "bedrock-runtime" else _STD
        _clients[service] = boto3.client(service, config=cfg)
    return _clients[service]
```

**AI 注意**：需要任何 AWS 客户端时写 `client("s3")`，**不要**写 `boto3.client("s3")`。

---

## 4. 配置与密钥（⭐ 最重要的一节）

### 4.1 所有资源名从 SSM Parameter Store 读

```python
# adapters/config.py
import os
from .aws import client

ssm = client("ssm")
STAGE = os.getenv("STAGE", "dev")
_cache: dict[str, str] = {}

def cfg(key: str) -> str:
    """读配置，进程内缓存（EC2 上是长驻进程，不要每次都打 SSM）。"""
    if key not in _cache:
        resp = ssm.get_parameter(Name=f"/stayright/{STAGE}/{key}",
                                 WithDecryption=True)
        _cache[key] = resp["Parameter"]["Value"]
    return _cache[key]
```

### 4.2 参数清单（12 个，已全部写入）

| SSM Key | 内容 | 当前实际值 ⚠️ 仅供排错对照 |
|---|---|---|
| `RAW_BUCKET` | 原文归档桶名 | `stayright-dev-raw-<账户ID>` |
| `SITE_BUCKET` | 结果页静态站桶名（**兼作 CI/CD 制品桶**，`releases/` 前缀） | `stayright-dev-site-<账户ID>` |
| `EVENT_BUS` | EventBridge 自定义总线名 | `stayright-dev-bus` |
| `EVENTS_QUEUE_URL` | 主队列 URL（**FIFO**） | `https://sqs.ap-southeast-2.amazonaws.com/.../stayright-dev-events.fifo` |
| `CALLBACKS_QUEUE_URL` | 回调队列 URL（**标准**） | `https://sqs.ap-southeast-2.amazonaws.com/.../stayright-dev-callbacks` |
| `BEDROCK_MODEL_ID` | 模型 ID（**推理配置文件**） | `au.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `SES_SENDER` | 发件地址 | 已验证的学校邮箱 |
| `FUNCTION_URL` | 回调入口 URL | ⏳ `PENDING_LAMBDA_DEPLOY`（SAM 部署后回填） |
| `SIGNAL_ENDPOINT_METSERVICE` | MetService CAP 端点 | `https://alerts.metservice.com/cap/rss` |
| `SIGNAL_ENDPOINT_GEONET` | GeoNet 端点 | `https://api.geonet.org.nz/volcano/val` |
| `SIGNAL_ENDPOINT_NZTA` | NZTA 端点 | `https://trafficnz.info/service/traffic/rest/4/events/all/10` |
| `SIGNAL_ENDPOINT_OAG` | OAG 端点 | `https://api.oag.com/flight-instances/` |

> 🚨 **右边这列只是给你排错时对照用的，代码里绝不能出现这些字符串。**
> 换到学校 AWS 账户后，桶名会全部变化（含新账户 ID）——**只有走 `cfg()` 的代码不用改**。

**用法示例**：
```python
s3.put_object(Bucket=cfg("RAW_BUCKET"), Key=key, Body=raw)   # ✅
s3.put_object(Bucket="stayright-dev-raw", Key=key, Body=raw) # ❌ 硬编码，换账户即废
```

### 4.3 密钥从 Secrets Manager 读

```python
# adapters/secrets.py
from .aws import client
from .config import STAGE

sm = client("secretsmanager")
_cache: dict[str, str] = {}

def secret(name: str) -> str:
    if name not in _cache:
        _cache[name] = sm.get_secret_value(
            SecretId=f"stayright/{STAGE}/{name}")["SecretString"]
    return _cache[name]
```

| Secret 名 | 内容 | 状态 |
|---|---|:-:|
| **`oag/api-key`** | OAG API Key ⚠️ **v1.0 写的是 `oag/subscription-key`，已更正** | 待填值 |
| `token/hmac-key` | 邮件一键动作链接的签名密钥（64 位 hex） | ✅ |
| `db/password` | Postgres 密码 | ✅ |

🚨 **密钥绝不进代码、绝不进 `.env`、绝不提交 Git。**

---

## 5. 十个 SDK 调用（本项目会用到的全部）

### 5.1 S3 —— 存原文 / 读状态 / 写结果页

```python
import hashlib, json
from .aws import client
from .config import cfg

s3 = client("s3")

def archive_raw(source: str, fetch_id: str, raw: bytes, ext: str, at) -> tuple[str, str]:
    """原始响应先落 S3 再解析——解析器出 bug 不能造成证据丢失。"""
    key = f"raw/{source}/{at:%Y/%m/%d}/{fetch_id}.{ext}"
    s3.put_object(Bucket=cfg("RAW_BUCKET"), Key=key, Body=raw)
    return f"s3://{cfg('RAW_BUCKET')}/{key}", "sha256:" + hashlib.sha256(raw).hexdigest()

def read_json(key: str) -> dict:
    try:
        return json.loads(s3.get_object(Bucket=cfg("RAW_BUCKET"), Key=key)["Body"].read())
    except s3.exceptions.NoSuchKey:
        return {}                       # 首次运行，正常情况

def write_json(key: str, data: dict) -> None:
    s3.put_object(Bucket=cfg("RAW_BUCKET"), Key=key,
                  Body=json.dumps(data, default=str).encode(),
                  ContentType="application/json")
```

| 易错点 | 说明 |
|---|---|
| `Body` 必须是 `bytes` 或文件对象，不能是 `dict` | 先 `json.dumps(...).encode()` |
| `get_object()["Body"]` 是流，**只能读一次** | 需要重复用就先存变量 |
| 不要传 `ServerSideEncryption` | 桶已配 AES256 默认加密；乱传 KMS 参数会因缺 Key 而失败 |
| 变化检测指纹存在 `state/{source}/state.json` | ADR #18.2：采集器在 VPC 外，够不着 EC2 里的 Postgres |
| 原文归档桶 90 天自动转 IA | 别依赖热读旧数据 |

**IAM**：`s3:GetObject`, `s3:PutObject`（SAM 模板：`S3CrudPolicy`）

---

### 5.2 SQS 收消息 —— 主循环（EC2 worker）

```python
from .aws import client
sqs = client("sqs")

def poll(queue_url: str):
    resp = sqs.receive_message(
        QueueUrl=queue_url,
        MaxNumberOfMessages=5,      # 1–10
        WaitTimeSeconds=20,         # ⭐ 长轮询，必须设，否则空转烧钱
        VisibilityTimeout=300,      # 必须 > 单条最坏处理时间
    )
    return resp.get("Messages", [])   # ⚠️ 没消息时没有 "Messages" 键

def ack(queue_url: str, receipt_handle: str):
    sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)
```

```python
# 正确的消费循环
for m in poll(cfg("EVENTS_QUEUE_URL")):
    body = json.loads(m["Body"])
    handle(body)                                       # 失败就让它抛
    ack(cfg("EVENTS_QUEUE_URL"), m["ReceiptHandle"])   # ⭐ 成功才删
```

| 易错点 | 说明 |
|---|---|
| 🚨 **失败时绝不 `delete_message`** | 不删 → 可见性超时后自动重投 → **3 次后进死信队列**（已配 redrive） |
| SQS 是**至少投递一次** | 消费者必须幂等：先查 `processed_events` 表，处理过就跳过 |
| `resp.get("Messages", [])` | 空队列时键不存在，直接 `resp["Messages"]` 会 KeyError |
| 队列消息保留期 14 天 | EC2 挂掉期间消息不丢（风险 R3 的缓解依据） |

**IAM**：`sqs:ReceiveMessage`, `sqs:DeleteMessage`（`SQSPollerPolicy`）

---

### 5.3 SQS 发消息

```python
import uuid

def send(queue_url: str, body: dict, group_id: str | None = None):
    kw = {"QueueUrl": queue_url, "MessageBody": json.dumps(body, default=str)}
    if queue_url.endswith(".fifo"):                 # ⭐ FIFO 队列必须带这两个
        kw["MessageGroupId"] = group_id or "default"
        kw["MessageDeduplicationId"] = body.get("event_id") or str(uuid.uuid4())
    sqs.send_message(**kw)
```

| 易错点 | 说明 |
|---|---|
| 🚨 FIFO 不带 `MessageGroupId` 直接报错 | 主队列用 `entity_key`（同一座火山/同一条路的变化要串行） |
| 回调队列是**标准队列** | 不要给它传 `MessageGroupId` |
| 主队列已开 `ContentBasedDeduplication` | 但仍建议显式传 `MessageDeduplicationId` |

**IAM**：`sqs:SendMessage`（`SQSSendMessagePolicy`）

---

### 5.4 EventBridge —— 采集器发布事件

```python
events = client("events")

def publish(evs: list[dict]) -> None:
    for i in range(0, len(evs), 10):                # 单次最多 10 条
        entries = [{
            "EventBusName": cfg("EVENT_BUS"),
            "Source":       "stayright.ingest",
            "DetailType":   "disruption.detected",
            "Detail":       json.dumps(e, default=str),   # ⚠️ 必须是字符串
        } for e in evs[i:i + 10]]
        resp = events.put_events(Entries=entries)
        if resp["FailedEntryCount"]:                # 🚨 必须检查
            raise RuntimeError(f"PutEvents 失败: {resp['Entries']}")
```

| 易错点 | 说明 |
|---|---|
| 🚨 **部分失败不抛异常** | 必须检查 `FailedEntryCount`，否则事件静默丢失 |
| `Detail` 是 JSON **字符串**，不是 dict | 忘记 `json.dumps` 会报格式错 |
| 单次 ≤ 10 条，单条 ≤ 256 KB | 超了要分批 |

**IAM**：`events:PutEvents`（`EventBridgePutEventsPolicy`）

---

### 5.5 Bedrock —— 大模型调用（结构化输出）

#### 🔴 两条硬规则（v1.1 新增，实测踩过坑）

| 规则 | 说明 |
|---|---|
| **必须用推理配置文件 ID，不能用基础模型 ID** | 悉尼区多数新版 Claude **不支持按需直调基础模型**，会报 `ValidationException: on-demand throughput isn't supported`。推理配置文件 ID 形如 `au.anthropic.claude-...` |
| **前缀只能是 `au.` 或 `apac.`，绝不能是 `global.`** | 前缀决定数据在哪些区域被处理：`au.` = 仅澳洲，`apac.` = 亚太，**`global.` = 全球任意区域**。项目选悉尼就是为了数据驻留（ADR #1），用 `global.` 直接违反。`infra/selftest.py` 里有守卫，改成 `global.` 会让冒烟测试失败 |

> 这两条你都不需要在代码里判断——**模型 ID 从 `cfg("BEDROCK_MODEL_ID")` 读**，正确的值已经在 SSM 里。
> 想换模型是 Zachary 改一个 SSM 参数的事，**你的代码一行都不用动**。

```python
bedrock = client("bedrock-runtime")

REFUND_TOOL = {
    "toolSpec": {
        "name": "submit_decision",
        "description": "提交结构化退款裁决",
        "inputSchema": {"json": {
            "type": "object",
            "properties": {
                "direction":   {"type": "string", "enum": [
                    "full_refund", "partial_refund", "free_rebook", "upgrade",
                    "deny_refund", "charge_penalty", "no_show_fee", "need_human"]},
                "refund_ratio": {"type": "number", "minimum": 0, "maximum": 1},
                "confidence":   {"type": "number", "minimum": 0, "maximum": 1},
                "source_span":  {"type": "string", "description": "政策原文片段，必须逐字引用"},
                "quote":        {"type": "string", "description": "给客人看的一句话理由"},
            },
            "required": ["direction", "refund_ratio", "confidence", "quote"],
        }},
    }
}

def decide(policy_spans: list[str], booking_desc: str) -> dict:
    resp = bedrock.converse(
        modelId=cfg("BEDROCK_MODEL_ID"),            # ⚠️ 从 SSM 读，不要硬编码
        system=[{"text": "只依据 <policy> 内的片段裁决；找不到依据必须返回 need_human。"}],
        messages=[{"role": "user", "content": [{"text":
            f"<policy>\n" + "\n---\n".join(policy_spans) + f"\n</policy>\n\n{booking_desc}"}]}],
        toolConfig={"tools": [REFUND_TOOL],
                    "toolChoice": {"tool": {"name": "submit_decision"}}},  # 强制调用
        inferenceConfig={"temperature": 0, "maxTokens": 1024},
    )
    for block in resp["output"]["message"]["content"]:
        if "toolUse" in block:
            return block["toolUse"]["input"]        # ← 已经是 dict，无需解析
    raise ValueError("模型未调用工具，按 need_human 处理")

def write_text(prompt: str) -> str:
    """邮件正文等自由文本。⚠️ 客人邮件正文必须逐单个性化生成，不要用模板拼。"""
    resp = bedrock.converse(
        modelId=cfg("BEDROCK_MODEL_ID"),
        messages=[{"role": "user", "content": [{"text": prompt}]}],
        inferenceConfig={"temperature": 0.3, "maxTokens": 800},
    )
    return resp["output"]["message"]["content"][0]["text"]
```

| 易错点 | 说明 |
|---|---|
| 🚨 **禁止用 Bedrock Knowledge Bases 的 quick-create** | 会静默创建 OpenSearch Serverless ≈ **$700/月**。向量检索一律用 pgvector |
| 要结构化输出就用 `toolConfig` | **不要**让模型返回文本再用正则抠字段 |
| 服务名是 `bedrock-runtime` | `bedrock` 是管控面（列模型用），推理面是 `bedrock-runtime` |
| `temperature=0` 用于裁决 | 裁决必须可复现 |
| `ThrottlingException` 已由 Config 自动重试 | 不要自己写退避 |
| 成本敏感 | 抵扣金池子与他人共用，别在循环里无节制调用；调试用短 prompt |

**IAM**：`bedrock:InvokeModel`（EC2 实例角色已具备）

---

### 5.6 SES v2 —— 发邮件

```python
ses = client("sesv2")                # ⚠️ 用 v2，不是旧的 "ses"

def send_email(to: str, subject: str, html: str) -> str:
    resp = ses.send_email(
        FromEmailAddress=cfg("SES_SENDER"),
        Destination={"ToAddresses": [to]},
        Content={"Simple": {
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {"Html": {"Data": html, "Charset": "UTF-8"}},
        }},
    )
    return resp["MessageId"]
```

| 易错点 | 说明 |
|---|---|
| 🚨 **沙箱模式：收件人和发件人都必须先验证** | 否则 `MessageRejected`。测试要发给某个邮箱，先找 Zachary 加进验证列表 |
| 配额 200 封/24h | 别写循环批量发测试邮件 |
| 中文必须设 `Charset: "UTF-8"` | 否则乱码 |
| 邮件里只放**出站的 token 链接** | 我们不解析入站自由文本回复 |
| HTML 里的用户数据必须 `html.escape()` | 房源名、客人姓名都要转义 |

**IAM**：`ses:SendEmail`

---

### 5.7 CloudWatch —— 自定义指标

```python
cw = client("cloudwatch")

def metric(name: str, value: float = 1, unit: str = "Count", **dims):
    cw.put_metric_data(Namespace="StayRight", MetricData=[{
        "MetricName": name, "Value": value, "Unit": unit,
        "Dimensions": [{"Name": k, "Value": str(v)} for k, v in dims.items()],
    }])
```

本项目必须打的指标：

```python
metric("FeedFetchSuccess", 1, Source="nzta")        # 每次轮询无论成败都打
metric("OagCallCount")                               # OAG 是唯一收费源，防超额
metric("TimeToFirstContactSeconds", secs, "Seconds", Source=ev.source)
metric("TtlScannerHeartbeat")                        # ⭐ 定时任务活着的证明（风险 R6）
metric("GateDecision", 1, Outcome="human")
```

| 易错点 | 说明 |
|---|---|
| `Value` 必须是数字，`Dimensions` 的值必须是字符串 | 传 int 会报类型错 |
| 单次调用 ≤ 1000 个数据点，维度 ≤ 30 | 一般用不到上限 |
| 打点也是网络调用 | 高频循环里要批量，别一条一打 |
| `TtlScannerHeartbeat` 不能漏 | 扫描器挂掉是**静默失效**，只有心跳指标能发现 |

**IAM**：`cloudwatch:PutMetricData`（EC2 实例角色已具备）

---

### 5.8 日志（CloudWatch Logs 自动采集，不需要 SDK）

```python
import json, logging
log = logging.getLogger(__name__)

log.info(json.dumps({"evt": "parse.done", "source": "nzta",
                     "in": 196, "out": 12, "ms": 34}))
```

| 规则 | 说明 |
|---|---|
| 一行一个 JSON，固定带 `evt` 字段 | CloudWatch Logs Insights 可按字段查询 |
| ❌ 不要用 `print()` | 在日志里是一坨没法搜索的文本 |
| ❌ 不要记录 API Key、token 原文、完整邮箱 | 邮箱写成 `zac***@gmail.com` |

---

### 5.9 Lambda Function URL —— 处理邮件里的一键动作

```python
# 这是本项目唯一对公网开放的代码，安全完全依赖 HMAC
import hmac, hashlib, base64, time, json
from .secrets import secret
from .config import cfg

def sign(exec_id: str, action: str, ttl_seconds: int) -> str:
    payload = f"{exec_id}|{action}|{int(time.time()) + ttl_seconds}"
    mac = hmac.new(secret("token/hmac-key").encode(),
                   payload.encode(), hashlib.sha256).hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{payload}|{mac}".encode()).decode().rstrip("=")

def verify(token: str) -> dict:
    raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)).decode()
    exec_id, action, exp, mac = raw.split("|")
    expect = hmac.new(secret("token/hmac-key").encode(),
                      f"{exec_id}|{action}|{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(mac, expect):      # ⚠️ 必须用 compare_digest
        raise ValueError("签名不匹配")
    if int(exp) < time.time():
        raise ValueError("链接已过期")
    return {"exec_id": exec_id, "action": action}

def handler(event, context):
    # Function URL 的事件结构（与 API Gateway 不同！）
    token = event["rawPath"].rsplit("/", 1)[-1]
    try:
        claim = verify(token)
    except Exception:
        return _html(400, "链接已失效或已被使用 ❌")
    send(cfg("CALLBACKS_QUEUE_URL"), {**claim, "at": time.time()})
    return _html(200, "已收到你的选择，我们正在为你锁定房源 ✅")

def _html(code: int, body: str) -> dict:
    return {"statusCode": code,
            "headers": {"content-type": "text/html; charset=utf-8"},
            "body": f"<html><body style='font-family:sans-serif;padding:40px'>{body}</body></html>"}
```

| 易错点 | 说明 |
|---|---|
| 用 `event["rawPath"]` | **不是** API Gateway 的 `pathParameters` |
| 必须用 `hmac.compare_digest` | 普通 `==` 有时序攻击风险 |
| URL 里绝不放明文 `booking_id` | 全部编码进签名 payload |
| token 一次性 | 消费时写 `used_tokens` 表，重复点击返回"已处理" |
| TTL 口径 | **客人 3h < 供应商 4h**，代码里加 `assert GUEST_TTL < SUPPLIER_TTL` |

---

### 5.10 Postgres（非 AWS，但写法要统一）

数据库跑在 **EC2 上的 Docker 容器**里，只监听 `127.0.0.1`——外网不可达，配合 EC2 零入站端口。

| 项 | 值 |
|---|---|
| 版本 | PostgreSQL 16.15 + PostGIS 3.4.3 + pgvector 0.8.6 |
| host / port | `127.0.0.1:5432`（仅实例内；本机调试见 §11.3） |
| database | `stayright` |
| 应用用户 | **`app`**（口令取自 Secrets Manager `db/password`） |
| 数据目录 | 宿主机 `/var/lib/pgdata`，容器重启不丢 |

```python
import json
import psycopg
from psycopg.rows import dict_row
from .secrets import secret

DSN = f"postgresql://app:{secret('db/password')}@localhost:5432/stayright"
conn = psycopg.connect(DSN, row_factory=dict_row, autocommit=False)

def find_by_geometry(geojson: dict, onset, expires) -> list[str]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT b.booking_id
            FROM bookings b JOIN properties p USING (property_id)
            WHERE ST_Intersects(p.geom, ST_GeomFromGeoJSON(%(g)s))
              AND b.status = 'confirmed'
              AND daterange(b.stay_start, b.stay_end, '[]')
               && daterange(%(o)s::date, %(e)s::date, '[]')
        """, {"g": json.dumps(geojson), "o": onset, "e": expires})
        return [r["booking_id"] for r in cur.fetchall()]
```

| 规则 | 说明 |
|---|---|
| 🚨 一律用命名参数 `%(name)s` | **绝不用 f-string 拼 SQL**（注入风险） |
| ❌ 不要用 ORM（SQLAlchemy 等） | PostGIS / pgvector 函数 ORM 支持差 |
| ❌ 不要 `SELECT *` | 显式列名 |
| 空间查询交给数据库 | 不要把房源读进内存用 Python 算距离，那样索引白建了 |
| 写回操作放在**单个事务**里 | 取消原单 + 建新单 + 写审计必须原子 |
| 匹配双语义 | 地理类走 `ST_Intersects`；航班类走"机场码 + 时间窗"，且**必须展开 codeshare** |

---

## 6. 错误处理

```python
from botocore.exceptions import ClientError

try:
    s3.get_object(Bucket=cfg("RAW_BUCKET"), Key=key)
except ClientError as e:
    code = e.response["Error"]["Code"]          # 用错误码判断，不要匹配错误文本
    if code == "NoSuchKey":
        return {}                               # 预期内，正常处理
    raise                                        # 其余一律抛出去
```

**三条原则**

1. **只捕获你知道怎么处理的错误**，其余让它抛
2. 用 `e.response["Error"]["Code"]` 判断，不要 `str(e)` 匹配文本
3. 🚨 **绝不 `except: pass`** —— SQS 的重试与死信队列全靠异常传播

---

## 7. 常见报错速查

| 报错 | 原因 | 怎么办 |
|---|---|---|
| `NoCredentialsError` | 本地没凭证 | **正常** —— 本地开发请用 `STAYRIGHT_LOCAL=1`（§11） |
| `AccessDenied` / `not authorized to perform` | IAM 缺权限 | 找 Zachary 加 policy |
| `ValidationException: on-demand throughput isn't supported`（Bedrock） | 用了基础模型 ID | 必须用推理配置文件 ID（`au.` 前缀），见 §5.5 |
| `AccessDeniedException`（Bedrock） | 模型未授权 | 找 Zachary；不是代码问题 |
| `ResourceNotFoundException`（Bedrock） | 模型 ID 错 | `aws bedrock list-inference-profiles --region ap-southeast-2`（**不是** `list-foundation-models`） |
| `ParameterNotFound`（SSM） | STAGE 不对或参数没写 | 确认 `STAGE=dev`；本地用假实现 |
| `NoSuchBucket` / `NonExistentQueue` | 资源名对不上 | 确认走了 `cfg()`，没硬编码 |
| `MessageRejected`（SES） | 沙箱模式收件人未验证 | 找 Zachary 验证你的邮箱 |
| `must contain the parameter MessageGroupId` | FIFO 队列没带 GroupId | 见 §5.3 |
| `FailedEntryCount > 0` | 事件格式错或权限不足 | 打印 `resp["Entries"]` 看 `ErrorCode` |
| 消息被重复处理 | `VisibilityTimeout` 太短 / 没做幂等 | 调大超时 + 查幂等表 |
| `EndpointConnectionError` | 区域写错 | 必须是 `ap-southeast-2` |
| 连不上数据库 | **EC2 可能是停机状态**（按需开停省成本） | 找 Zachary 开机；或本地起 Docker（§11.2） |
| `SessionManagerPlugin is not found` | 缺插件 | `brew install --cask session-manager-plugin` |

---

## 8. IAM 权限对照（写给 Zachary 配模板用，开发者知道即可）

| 你调用的 | 需要的权限 | SAM Policy Template |
|---|---|---|
| `s3.put_object` / `get_object` | `s3:PutObject` `s3:GetObject` | `S3CrudPolicy` |
| `events.put_events` | `events:PutEvents` | `EventBridgePutEventsPolicy` |
| `sqs.receive_message` / `delete_message` | `sqs:ReceiveMessage` `sqs:DeleteMessage` | `SQSPollerPolicy` |
| `sqs.send_message` | `sqs:SendMessage` | `SQSSendMessagePolicy` |
| `bedrock.converse` | `bedrock:InvokeModel` | 手写 Statement |
| `ses.send_email` | `ses:SendEmail` | `SESCrudPolicy` |
| `ssm.get_parameter` | `ssm:GetParameter` | `SSMParameterReadPolicy` |
| `sm.get_secret_value` | `secretsmanager:GetSecretValue` | `AWSSecretsManagerGetSecretValuePolicy` |
| `cw.put_metric_data` | `cloudwatch:PutMetricData` | `CloudWatchPutMetricPolicy` |

> EC2 实例角色 `stayright-dev-ec2-role` 已具备上述全部权限。

---

## 9. ⭐ 本地假实现（AWS 在不在线都不影响你）

虽然 AWS 已经开通，**日常开发仍然一律走假实现**：不烧抵扣金、不依赖 EC2 开机、PR 阶段 CI 也不需要 AWS 凭证。

```python
# adapters/factory.py —— 唯一决定"用真 AWS 还是本地假实现"的地方
import os
LOCAL = os.getenv("STAYRIGHT_LOCAL") == "1"

def get_storage():
    if LOCAL:
        from .fakes import LocalStorage
        return LocalStorage("./.local/s3")     # 写本地目录
    from .store_s3 import S3Storage
    return S3Storage()

def get_llm():
    if LOCAL:
        from .fakes import FakeLLM
        return FakeLLM()                        # 返回固定的裁决结果
    from .llm_bedrock import BedrockLLM
    return BedrockLLM()
```

```python
# adapters/fakes.py —— 假实现要和真实现方法签名完全一致
import json, pathlib

class LocalStorage:
    def __init__(self, root): self.root = pathlib.Path(root); self.root.mkdir(parents=True, exist_ok=True)
    def put(self, key: str, data: bytes) -> str:
        p = self.root / key; p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data); return f"file://{p}"
    def get_json(self, key: str) -> dict:
        p = self.root / key
        return json.loads(p.read_text()) if p.exists() else {}

class FakeLLM:
    def decide(self, spans, desc):
        return {"direction": "full_refund", "refund_ratio": 1.0, "confidence": 0.9,
                "source_span": spans[0] if spans else "", "quote": "（假数据）恶劣天气可全额退款"}
    def write_text(self, prompt): return "（假数据）邮件正文"
```

**开发时**：`STAYRIGHT_LOCAL=1 python -m your_module` → 完全不碰 AWS，也能跑通全流程。
**真机验证时**：去掉环境变量即可，**业务代码一行不改**。

> 这就是为什么 §2 铁律 1 要求"资源名一律从配置读"——真假切换才成立。

---

## 10. 提交前自检

```bash
grep -rn "boto3.client(" src/ | grep -v aws.py    # 应无输出（client 只在 aws.py 建）
grep -rniE "AKIA|aws_secret_access_key" src/       # 应无输出（不许有密钥）
grep -rn "except.*:\s*pass" src/                   # 应无输出（不许吞异常）
grep -rn "print(" src/                             # 应无输出（用 logging）
grep -rniE "select \*" src/                        # 应无输出
grep -rn "global\.anthropic\|global\.amazon" src/  # 应无输出（数据驻留，见 §5.5）
grep -rnE "stayright-dev-|amazonaws\.com/[0-9]{12}" src/   # 应无输出（不许硬编码资源名）
make lint                                          # 4 条分层边界守卫
STAYRIGHT_LOCAL=1 make test                        # 全绿 + 覆盖率门禁
```

---

## 11. 本地开发环境准备（v1.1 新增）

### 11.1 你**不需要**的东西

| ❌ 不需要 | 原因 |
|---|---|
| AWS 账号 / Access Key | 本地走假实现；线上走 IAM 角色 |
| 连上 EC2 | 数据库本地起一个就行 |
| 装 AWS CLI | 除非你要排错 |

### 11.2 你需要的（一次性，约 10 分钟）

```bash
# Python 3.12 + 依赖
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 本地 Postgres（与线上同版本、同扩展）
docker run -d --name sr-pg \
  -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=stayright \
  -p 5432:5432 postgis/postgis:16-3.4

# ⚠️ 该镜像不含 pgvector，需补装（线上也是这么做的）
docker exec sr-pg bash -c "apt-get update -qq && apt-get install -y -qq postgresql-16-pgvector"
docker restart sr-pg && sleep 15
docker exec sr-pg psql -U postgres -d stayright -c \
  "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS vector;
   CREATE ROLE app LOGIN PASSWORD 'devpassword';
   GRANT ALL ON DATABASE stayright TO app; GRANT ALL ON SCHEMA public TO app;"

# 跑测试
STAYRIGHT_LOCAL=1 make test
```

### 11.3 需要连线上数据库时（少数情况）

EC2 零入站端口，走 SSM 端口转发，**不开任何端口**：

```bash
aws ssm start-session --target <实例ID> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5432"],"localPortNumber":["15432"]}'
```

然后 GUI 工具连 `localhost:15432`。实例 ID 和口令找 Zachary 要（在 `infra/连接信息.md`）。

---

## 12. 部署方式（v1.1 新增，你不需要手动部署）

```
git push main  →  GitHub Actions
                    ├─ gate:   make lint + 测试（不碰 AWS）
                    └─ deploy: 打包 → S3 → SSM Run Command → EC2 重启服务
                               sam build && sam deploy（5 个 Lambda）
```

| 要点 | 说明 |
|---|---|
| **你只管 push**，不要手动登录 EC2 改代码 | 手改会被下次部署覆盖 |
| PR 阶段跑 `gate`，合并到 `main` 才部署 dev | 打 tag `v*` 部署 demo |
| 回滚 = 重发旧 commit 的部署 | 约 40 秒 |
| 部署会自动开机 | EC2 平时是停机状态 |
| 评审前 48 小时冻结 demo 环境 | 别在那期间打 tag |

---

## 附：给 AI 的一句话总结

> 本项目所有 AWS 调用都通过 `adapters/aws.py` 的 `client()` 获取客户端；所有资源名通过 `cfg("KEY")` 从 SSM 读取，**绝不硬编码**；所有密钥通过 `secret("name")` 从 Secrets Manager 读取；区域固定 `ap-southeast-2`；Bedrock 模型 ID 必须是 SSM 里的**推理配置文件 ID**（`au.` 前缀，绝不用 `global.`）；`src/core/` 是纯函数层，禁止出现 boto3 / os.environ / datetime.now()；失败必须抛出异常不许吞；SQS 消费成功才删消息；Bedrock 用 `converse` + `toolConfig` 拿结构化输出；SES 用 v2 且处于沙箱模式（收件人须预先验证）；Postgres 用 `app` 用户 + 命名参数，不用 ORM；日常开发一律 `STAYRIGHT_LOCAL=1` 走本地假实现，不依赖 AWS 在线。
