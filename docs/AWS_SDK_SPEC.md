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
| IaC | 非代码资源由脚本建；5 个 Lambda 走 SAM（开发者不写模板）。`infra/连接信息.md`、`infra/手建资源清单.md` 是 `.gitignore` 里登记的本地专属文件（含连接口令等敏感信息），不进仓库属预期设计，找 Zachary 要。⚠️ 但 `infra/bootstrap.sh`、`infra/selftest.py` 不在 `.gitignore` 名单里，`infra/` 目前也只有 `.gitkeep`——这两个脚本是未提交还是尚未编写，待 Zachary 确认 |

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
| Lambda ×5 | ✅ 4/5 已部署（2026-09-03） | 4 个采集器（weather/volcano/flight/road）已随 SAM 栈 `stayright-dev-weather-collector` 上线并实测；回调 Lambda（第 5 个）未写、未部署。详细部署记录见 §13.2 2026-09-03 条目 |

> ⚠️ **EC2 是按需开停的**（省抵扣金）。你连不上数据库时，先问 Zachary 机器开着没有。
> 👉 即便如此，**开发不依赖 AWS 是否在线**——用 §9 的本地假实现。

> 📌 **2026-08-27 复核（Zachary 实测）**：上表资源仍在线。Lambda 仍为 0（MVP 只需 1 个 `weather-collector`）；SES 仍处沙箱（发件人已验证）；EC2 当前运行中、未绑 Elastic IP；线上 Postgres 实为 EC2 上的 **Docker 容器 `pg`**（`postgis/postgis:16-3.4`），库 `stayright` 为空库待应用首次迁移建表。新增待建资源：SSM `API_BASE_URL`、Secret `ingest/shared-key`（探测 → C# 建案桥接用）。

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
| 连不上数据库 | **EC2 可能是停机状态**（按需开停省成本），或 SSM 隧道没开 | 找 Zachary 开机；开隧道（§11.2 / `DATABASE_ACCESS.md`） |
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
| AWS 账号 / Access Key（只跑 `detect/` 测试） | 测试走假实现 / mock |
| 本地 Postgres | 不再有；数据库统一连线上（见 §11.2） |

### 11.2 你需要的

`detect/` 的单元测试不碰库，`cd detect && python -m pytest` 即可。

**要跑起后端/前端联调，或跑 `identify` / e2e 脚本，就要连数据库**。2026-09-10 起
不再本地跑 Docker Postgres，一律经 SSM 端口转发隧道连线上 EC2 的共享 `stayright` 库：

```bash
# Python 3.12 + 依赖
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 开隧道（新终端，一直挂着）——需要 IAM ssm:StartSession，实例 ID / 口令找 Zachary
aws ssm start-session --region ap-southeast-2 --target <实例ID> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5432"],"localPortNumber":["15432"]}'

# 根目录 .env 的 PG* / POSTGRES_* 已指向 127.0.0.1:15432 / stayright
```

完整连法、DBeaver、schema 变更纪律见 `docs/DATABASE_ACCESS.md`。
⚠️ 共享库，`dotnet run` 默认不再自动迁移——见 `DATABASE_ACCESS.md` §5。

---

## 12. 部署方式（2026-09-09 更新为实际方案）

本节原描述的"push main 触发 GitHub Actions 自动部署"从未落地——这个仓库所在的 GitHub 组织把 Actions 的 `allowed_actions` 限制成 `local_only`（只允许本仓库内定义的 action，`actions/checkout` 等一律不放行），`.github/workflows/gate.yml` 每次触发都是 `startup_failure`。该策略在组织层强制、repo 层改不了。2026-09-09 Zachary 拍板：不再等组织放开，CI/CD 全部走 AWS，`.github/workflows/gate.yml` 已删除。

**现方案：AWS CodePipeline + CodeBuild**，完全在 AWS 账号权限内，不依赖 GitHub Actions。

**分支模型**：`开发分支 --PR--> Test（集成）--PR--> main（发布）`。部署只从 `main` 出。

```
【PR 阶段】PR 进 Test / main
   → CodeBuild stayright-gate-pr（GitHub webhook 触发）
   → 跑 gate（pytest + dotnet build + npm lint/build），结果回写 PR commit status

【合并后】提交进 main
   → CodePipeline（DetectChanges=true，盯 main）自动跑：
      Source（CodeStar Connection 拉 main）
        ↓
      Gate（CodeBuild stayright-gate：同一套 gate 检查）
        ↓ 全绿才往下走
      Approval（人工审批，控制台点 Approve 才继续）
        ↓
      Deploy（并行：deploy-backend 走 SSM RunCommand 原地换目录到 EC2；
              deploy-frontend 走 S3 sync + CloudFront 失效）
```

搭建脚本：`infra/bootstrap-cicd.sh`（幂等，可反复跑；创建 CodeStar Connection / IAM 角色 / CodeBuild 项目 / webhook / CodePipeline，全部可逆）。各阶段的构建定义在 `.codebuild/buildspec-*.yml`，部署逻辑直接调用现成的 `scripts/deploy-backend.sh` / `scripts/deploy-frontend.sh`，没有重复实现。

| 要点 | 说明 |
|---|---|
| PR gate（`stayright-gate-pr`） | GitHub webhook，只对目标分支是 `Test` / `main` 的 PR（打开/更新/重开）触发；`reportBuildStatus=true` 回写 commit status |
| pipeline 触发（`stayright-dev-pipeline`） | `DetectChanges: true`，盯 `main`；`main` 一有新提交自动跑。也可手动 `aws codepipeline start-pipeline-execution` / 控制台 "Release change" |
| `Test` 分支自身 | 不触发部署，只有 PR gate。想跑全量检查就本地 `cd detect && pytest` 等 |
| Lambda 采集器部署**不在**这条 pipeline 里 | `buildspec-deploy-lambda.yml` 已写好但没建对应 CodeBuild 项目——采集器改动频率低，暂时保持手动 `sam deploy`（`--manifest requirements-lambda.txt`，精简依赖） |
| EC2 是按需开停的 | 触发部署前先确认 EC2 是开机状态，否则 SSM RunCommand 会失败 |
| 回滚 | EC2 上 `systemctl stop stayright-api && rm -rf api && mv api.old api && systemctl start stayright-api`（`deploy-backend.sh` 头部注释有完整命令） |

---

## 13. 部署历史与决策记录（并自 `AWS-Deployment-History.md`，2026-09-08 合并）

> 本节记录 Kakapo（StayRight NZ）项目 AWS 部署相关的排查结论、方案决策和代码改动，按时间顺序追加，不回改历史条目。跟本文件其余章节/`CLAUDE.md`/`docs/DATABASE_ACCESS.md` 的关系：那些是"规范应该是什么样"，本节是"我们实际做到哪一步、为什么这么做"。原单独文件 `AWS-Deployment-History.md`（根目录）已于 2026-09-08 并入本节，为精简文档数量、避免核心参考材料游离在 `docs/` 之外。

### 13.1 决策记录（ADR）

本文件正文多处引用 `ADR #编号`（架构决策）。这些编号此前没有集中记录来源，此处补一份最小索引，往后新增架构级决策按编号追加：

| 编号 | 决策 | 备注 |
|---|---|---|
| ADR #1 | 云区域固定 `ap-southeast-2`（悉尼），不使用其他区域 | 数据驻留要求（NZ 用户数据留在澳新地区）；Bedrock 模型 ID 前缀只能 `au.`/`apac.`，禁止 `global.` 也是同一条决策的延伸 |
| ADR #18 | ⑤⑥⑦ 层（match/gate/verdict）收在一台 EC2 的单个 Python 进程里，做成模块化单体，而不是拆成多个 Lambda | 权衡：MVP 阶段减少运维复杂度；4 个采集器 + 1 个回调仍走 Lambda |
| ADR #18.2 | 采集器 Lambda 部署在 VPC 外 | 原因：采集器不需要直连 EC2 里的 Postgres（只经 HTTPS POST 给 C# 后端摄入），留在 VPC 外可以零 NAT 网关成本 |

> 后续新的架构级决策（比如本轮对话里定的「D4：embedding 供应商维持 Gemini」「D6：backend SSM 铁律范围」「prod 环境建在独立新账户」）如果需要长期可查，按同样的表格追加编号即可，不必每条决策单独开文件。

### 13.2 时间线日志

### 2026-08-24

#### 背景：MVP 目标收窄

产品当前阶段是 MVP，目标不是把 CLAUDE.md/AWS_SDK_SPEC.md 描述的完整管线（采集→变化检测→匹配→闸门→裁决→触达→回调→重订，4 采集器 Lambda + EC2 worker + SQS + EventBridge + Bedrock + SES + 回调 Lambda）一次性建完，而是**只用天气一个信号源，验证 AWS 架构本身、以及前后端能不能联动跑通**。验证通过后再逐步加其他信号源（GeoNet、NZTA、OAG）。

#### 排查结论：仓库现状跟 CLAUDE.md 描述的目标架构有落差

- 仓库里同时存在两套技术栈：
  - `src/`（Python 3.12）—— 只有 `detect/`（Open-Meteo 天气探测）和 `identify/`（受影响预订匹配）两段，符合 CLAUDE.md 锁定的 Python/boto3/PostGIS 技术栈方向，但还没有 `src/core/adapters/runtimes` 三层分层，零 boto3 调用，AWS 集成完全没接入。
  - `backend/`（C#/.NET 9）+ `frontend/`（Vite/React/TS）—— 一个完整的运营台应用（Auth、Bookings、Cases、Coordinator、Hotel、Chat 等），用 EF Core（ORM）+ Gemini，直接违反 CLAUDE.md"不用 ORM"" 用 Bedrock 不用 Gemini"的硬性要求。这套应用是产品实际的人工工作流后端，已经相当完整。
- `docs/AWS_SDK_SPEC.md` 描述的服务（SSM 12 参数、Secrets Manager 3 个、S3×2、SQS×3、EventBridge、Bedrock、SES、EC2+PostGIS+pgvector）已经开通并冒烟验收（2026-08-21），但 **Lambda ×5 仍是"待部署"**，管线代码本身（match/gate/verdict/notify/callback/rebook）在 `src/` 里完全没有实现。
- 仓库原本**没有 `.github/` 目录，没有任何 CI/CD**。
- 一个关键发现：`backend/Features/Disruption/DisruptionsController.cs` 已经实现了完整的"扰动 → 候选预订匹配 → 建案 → 协调员分配 → 通知（SMTP 邮件）→ 运营台展示"工作流，只是现在的数据来源是静态种子文件 `backend/SeedData/disruptions.json`，没有一个真正的"创建扰动"接口。运营台前端 `frontend/src/features/coordinator/DisruptionsPanel.tsx` 已经能展示这些。

**结论**：MVP 要验证的东西，实际缺口比"把 Python 管线 8 段全部写完"小得多——C# 后端已经把探测之后的业务逻辑做完了，缺的是"用一次真实的天气探测结果替代那份静态 JSON"。

#### 决策：Python 只做探测，C# 做探测之后的一切

两边不是二选一，是同一个系统里各管一段：

```
Python（Lambda，定时探测）── HTTPS POST ──▶ C#（建案/匹配/通知/运营台，已存在）
```

不重新在 Python 里实现 match/gate/verdict/notify——避免两套平行的业务逻辑。

#### 已完成：Gate CI（`.github/workflows/gate.yml`）

- 三个 job：Python（`pytest`）、.NET（`dotnet build backend.sln`）、前端（`oxlint` + `vite build`），全部不需要 AWS 凭证。
- 触发条件按团队要求限定为**只在 `Dev-Zachary → Test` 的 PR 上跑**（`on.pull_request.branches: [Test]` + 各 job 加 `if: github.head_ref == 'Dev-Zachary'` 判断来源分支，`on.pull_request.branches` 本身只能过滤目标分支）。
- `backend/` 目录下 `.sln` 和 `.csproj` 并存导致 `dotnet restore`/`build` 报"多个项目文件"歧义，已改成显式指定 `backend.sln` 解决。
- 本地验证：Python 23 passed / 1 skipped，`.NET` build succeeded 0 warning 0 error，前端 lint + build 通过。
- Commit：`6616394` chore(ci): add gate workflow for Dev-Zachary to Test PRs

#### 已完成：探测 → C# 建案 的最小桥接（代码，未接真实 AWS）

**C# backend（新增，未改现有业务逻辑）**
- `Features/Disruption/IDisruptionRepository.cs` / `DisruptionRepository.cs` —— 新增 `AddDisruptionAsync`
- `Features/Disruption/IDisruptionService.cs` / `DisruptionService.cs` —— 新增 `IngestAsync`
- `Features/Disruption/DisruptionDtos.cs` —— 新增 `CreateDisruptionRequest` / `CreateDisruptionResultDto`
- `Infrastructure/Auth/IngestKeyAuthFilter.cs`（新）—— 机器对机器鉴权，比对请求头 `X-Ingest-Key` 与环境变量 `INGEST_SHARED_KEY`，不走 cookie 会话
- `Features/Ingest/IngestController.cs`（新）—— `POST /api/ingest/disruptions`

**Python（新增 `adapters/` 和 `runtimes/`）**
- `src/adapters/aws.py`、`config.py`、`secrets.py` —— 按 `docs/AWS_SDK_SPEC.md` §3/§4 写的骨架（`client()` 工厂、`cfg()` 读 SSM、`secret()` 读 Secrets Manager）
- `src/runtimes/lambda_weather_collector.py`（新）—— Lambda handler：轮询天气 → `classify()` 判断风险 → 有风险则 POST 给 C# 新接口
- `requirements.txt` 新增 `boto3`
- `tests/test_lambda_weather_collector.py`（新，4 条测试，mock 掉 `cfg`/`secret`/`requests.post`）

本地验证：`dotnet build` 通过；`pytest` 27 passed / 1 skipped（含新增 4 条）。

Commit：`829526a` feat: bridge weather detection into existing disruption workflow

**有意没做的事**：没有写 SAM 模板、没有创建任何 SSM 参数或 Secrets Manager 密钥——`docs/AWS_SDK_SPEC.md` §1 明确写"5 个 Lambda 走 SAM（开发者不写模板）"，这部分留给 Zachary。

#### 待办：Zachary 需要提供 / 建的资源

- 新 SSM 参数 `API_BASE_URL`（值是 C# API 的可访问地址，CloudFront 域名或 EC2 地址）
- 新 Secret `ingest/shared-key`（Lambda 和 C# 后端要读到同一个值）
- SAM 模板 + `weather-collector` Lambda 部署 + EventBridge Scheduler 定时规则
- Lambda 执行角色 IAM policy：`ssm:GetParameter`、`secretsmanager:GetSecretValue`
- 前后端上线到 AWS 的基础设施（"线 B"）：EC2 上新增 `stayright-api.service`（.NET）systemd 服务；新建私有 S3 桶 + CloudFront 分发托管前端静态站，`/api/*` 路径转发到 EC2；EC2 分配 Elastic IP（现在按需开停，地址不固定）；安全组放行 CloudFront 托管前缀列表访问 API 端口

#### 待办：本项目侧（不依赖 Zachary）

- 本地起 `docker-compose` + `dotnet run`，手工 `curl` 一次 `POST /api/ingest/disruptions`，验证鉴权和建库逻辑真的работ（还没做）
- push 现有两个 commit 到 `origin/Dev-Zachary`，开 PR 到 `Test`，确认 Gate CI 在 GitHub 上真的跑得通（本地验证过逻辑，还没在 GitHub Actions 上跑过一次）
- Gate CI 的 Python job 还没加 `docs/AWS_SDK_SPEC.md` §10 那 7 条 grep 自检和 `STAYRIGHT_LOCAL=1`（讨论过，判定为低成本可加，尚未执行）

#### 未决问题（需要团队/Zachary 拍板，非我可单方面决定）

- 三处数据库名不一致：根目录 `docker-compose.yml`（backend 用）是 `travel_disruption`，`.env.example`（Python 用）是 `kakapo`，`docs/AWS_SDK_SPEC.md` §5.10 写的是 `stayright`。低成本处理方式是同一个 Postgres 实例上开多个独立数据库，暂不合并 schema。
- 候选预订匹配逻辑在两边重复实现：C# 用酒店地址字符串模糊匹配区域名（`ILike`），Python `identify/matcher.py` 用真实地理距离（haversine，以后可换 PostGIS）。长期该保留哪一套、要不要合并，未定。
- 部署触发分支：Gate CI 现在挂在 `Test` 分支的 PR 上，但 `docs/AWS_SDK_SPEC.md` §12 原文写的是"合并到 main 才部署 dev"。真正的 `deploy` workflow 该挂在哪个分支（`Test` 还是 `main`，或者 `Test` 只是中间集成分支）还没确认。
- `frontend/` 和 `backend/` 该不该继续保留 C#/Gemini 技术栈，还是长期往 CLAUDE.md 锁定的 Python/Bedrock 方向迁移，这个更大的架构方向问题，本文件不做定论。

---

### 2026-08-27

#### 合并 Test → Dev-Zachary（本地）

- 目的：开 PR 前先吸收队友 8/23–8/26 的进展（PR #63–#67：detect/ 目录重组、handoff 集成、FAQ 聚类等）。
- 形式冲突仅 1 个（文件位置）：`tests/test_lambda_weather_collector.py` 因 Test 把整个 Python 原型挪进 `detect/` 而需重定位。C# 侧（Disruption 三件套等）全部自动合并，`dotnet build` 0 警告 0 错误。
- 结构跟随：`src/adapters/`、`src/runtimes/` 手动 `git mv` 到 `detect/src/` 下；import 无需改动（`detect/pyproject.toml` 配 `pythonpath=["."]`，代码统一 `from src.xxx`）。根 `requirements.txt` 的 boto3 由 git rename 检测自动带入 `detect/requirements.txt`。
- 语义冲突 1 处（git 无法发现）：`build_disruption_event` 签名变更（PR #64 引入 `find_risky_window` 按小时预报推导风险窗口）。`lambda_weather_collector.py` 的 handler 从 `fetch_weather + classify` 路径改为 `fetch_forecast + find_risky_window` 路径（与 `detect_events()` 同构），测试 fixture 同步改为小时预报形状（借鉴 `test_detect.py` 的 `_hourly_forecast`）。
- 验证：`pytest` 37 passed / 1 skipped；`dotnet build backend/backend.sln` 成功。

#### 决策（2026-08-27，Zachary 拍板）

1. **部署方式**：MVP 阶段先纯手动部署（SAM CLI + EC2 systemd 手工操作），deploy workflow 自动化（规范 §12 描述的 push→Actions→SSM Run Command 链路）留到后续。
2. **数据库名统一为 `stayright`**：线上 EC2 Postgres 建库用 `stayright`；解决此前 travel_disruption / kakapo / stayright 三处不一致。本地 docker-compose 仍默认 `travel_disruption`，不强改（本地与线上库名不同不影响功能，靠环境变量区分）。

#### 排查：detect/ 信号源与前端部署可行性（2026-08-27）

- `detect/src/detect/` 目前**只有天气一个信号源**（`open_meteo.py`）。`models.py` 的 `EventSource` 枚举虽定义了 WEATHER/FLIGHT/ROAD 三种，但 FLIGHT（OAG 航班）和 ROAD（NZTA/GeoNet 道路）均无实现代码；SSM 里的 4 个 SIGNAL_ENDPOINT_* 参数只是规范预留。
- 前端 `npm run build` 通过（gzip 后 JS 113.8KB），静态产物可直接发布到已有的 `stayright-dev-site` 桶 + CloudFront。

#### 实测：AWS 云端资源盘点（2026-08-27，ap-southeast-2，账号 990393187001）

用 Zachary 的 IAM 凭证 + SSM RunCommand 只读核查：

| 资源 | 状态 |
|---|---|
| SSM Parameter Store | ✅ 8/21 那 12 个 `/stayright/dev/*` 参数原样在；**缺 `API_BASE_URL`** |
| Secrets Manager | ✅ 3 个（`db/password`、`token/hmac-key`、`oag/api-key`）；**缺 `ingest/shared-key`** |
| S3 | ✅ `stayright-dev-raw` / `stayright-dev-site` 两桶（8/21 建） |
| EC2 | `stayright-dev-box`（i-0d71260ab44ceb0c3，t3.micro）**运行中**，IP 15.134.136.245 非固定（未绑 EIP）；SSM Online |
| Lambda | ❌ 0 个 |
| EventBridge Scheduler | ❌ 0 条规则 |
| CloudFront | ❌ 无 StayRight 分发（同账号仅有 ielts-quest 项目的一条） |
| SES | 沙箱模式（`ProductionAccessEnabled=false`）；发件人 `szha564@aucklanduni.ac.nz` 已验证；配额 200 封/24h |

同账号另有他项目资源（ielts-quest 的 Elastic Beanstalk/CloudFront/EIP、candidate-sim 容器），操作时注意别认错。

#### 实测：EC2 上的数据库（2026-08-27）

- Postgres 跑在 **Docker 容器 `pg`**（镜像 `postgis/postgis:16-3.4`，监听 `127.0.0.1:5432`，docker-proxy 转发），**不是系统服务**——`DATABASE_ACCESS.md` 场景 B 的「系统服务 + postgres 用户」描述与实机不符，机器上没有 `postgres` 系统用户，EC2 上执行 SQL 要用 `sudo docker exec pg psql ...`（文档已补注）。
- PostgreSQL **16.15**（Debian）；业务库只有 `stayright` 一个；登录角色 `app` + `postgres`。
- 扩展齐备：**postgis ✅ vector(pgvector) ✅**（另有 fuzzystrmatch/tiger/topology 系统对象）。
- **零业务表**——空库，等 C# EF 迁移首次部署从零建表。
- 密码：容器 env 为本地同一 dev 密码；与 Secrets Manager `stayright/dev/db/password` 是否一致**未核对**（不在终端输出展示密钥值）。部署时若按 secret 连不上库，先查这里。
- 结论：「库名 stayright」决策与实机现状一致，零迁移成本。

#### 部署计划定稿（2026-08-27）

**前置（代码/流程侧，半天）**

- P1：push `Dev-Zachary`（含 Test 合并，领先 origin 18 提交）+ 开 PR → `Test`，Gate CI 在 GitHub 首跑
- P2：本地 `curl POST /api/ingest/disruptions` 验证鉴权 + 建库（本地栈已验证可跑：docker compose Postgres + `dotnet run`（5080）+ vite（5173）；种子账号密码统一 `Password123!`，登录名字段为 `identifier`，邮箱或昵称均可）

**线 B：托管基础设施（手动执行）**

| # | 任务 | 关键点 |
|---|---|---|
| B1 | EC2 装 .NET 9 + systemd `stayright-api.service` | env 注入 `POSTGRES_DB=stayright`、`POSTGRES_PASSWORD=<secret 值>`、`INGEST_SHARED_KEY`、`FRONTEND_ORIGIN=<CloudFront 域名>`；`GEMINI_API_KEY` 可选（缺失仅 AI/FAQ 降级） |
| B2 | Elastic IP 绑定 `stayright-dev-box` | 固定回源地址 |
| B3 | 前端按公网域名重新构建后上传 `stayright-dev-site` | `VITE_API_BASE_URL` 设为 CloudFront 域名或空串（同源相对路径）；不设会打默认 `localhost:5080` |
| B4 | CloudFront 分发：`/` 走 S3（OAC 私有桶）、`/api/*` 回源 EC2 | 前后端同域，cookie 认证零跨域配置 |
| B5 | 安全组放行 CloudFront 托管前缀列表 → EC2 API 端口 | 不对公网裸开端口 |

**线 A：Lambda 探测管线（手动执行，依赖线 B 就绪）**

| # | 任务 |
|---|---|
| A1 | SSM 参数 `API_BASE_URL`（值 = CloudFront 域名） |
| A2 | Secret `ingest/shared-key`（与 B1 的 `INGEST_SHARED_KEY` 同值） |
| A3 | SAM 模板 + 部署 `detect/src/runtimes/lambda_weather_collector`（Python 3.12，已适配预报窗口新 API） |
| A4 | EventBridge Scheduler 定时规则 |
| A5 | Lambda 执行角色 IAM policy：`ssm:GetParameter` + `secretsmanager:GetSecretValue` |

**演示前风险清单**

- SES 沙箱：先逐个验证 2–3 个真实收件邮箱（推荐方案 A）；种子用户邮箱全是 `@example.com` 假地址，演示「通知」环节前把演示账号 contact 改成已验证邮箱。可顺手提交 production access 申请当备份（免费、审核慢）。
- EC2 成本：部署验证完考虑停机（规范本意按需开停）。
- `.gitignore` 里登记的 `infra/连接信息.md`、`infra/手建资源清单.md` 本地不存在，手建资源记录目前只在本文件——SAM 模板编写时以本文盘点为准。

---

### 2026-08-27（下午）：P2 + 线 B 前半段执行记录

#### 前置完成情况

- **GitHub Actions 被组织级策略禁用**（repo 设置 `enabled:false`，且组织策略 Conflict 无法在 repo 层开启；gh token 也无 admin:org scope）。结论：不影响部署——方案本就是手动直连 AWS；Gate 的三项检查以本地结果代替（pytest 37/1、dotnet build 0/0、前端 build 通过）。PR #68 已开（Dev-Zachary → Test），无 CI 检查不影响评审合并。后续想启用需找组织 owner。
- **P2 本地 ingest 验证 ✅**：错误密钥 401 / 正确密钥 200，`disruptions` 表落库（id 30725a9f…）。确认 `IngestAsync` 只建 Disruption 行，候选通知/建案走协调员后续流程。

#### A2（提前完成）

- Secret `stayright/dev/ingest/shared-key` 已建（openssl rand -hex 24 生成，值同时用于 EC2 的 `INGEST_SHARED_KEY`）。
- **密码一致性核对结果：MATCH**——Secrets Manager `stayright/dev/db/password` 与 EC2 容器实际密码相同（比对脚本未回显值）。此前的 ⚠️ 解除。

#### B1：EC2 后端部署 ✅（踩了两个坑）

1. **缺 libicu**：AL2023 最小安装没有 ICU，.NET 启动即 FailFast。`dnf install -y libicu` 解决。
2. **发布包缺 rag 种子文件（仓库级 bug）**：Web SDK 默认只把 `*.json` 拷进 publish 输出，`SeedData/rag/*.md` 三个文件没带上 → EC2 首启 SeedRunner `DirectoryNotFoundException` 崩溃重启循环。本地源码目录运行不暴露此问题。已修：csproj 显式声明 `<Content Include="SeedData/rag/**/*.md" CopyToOutputDirectory="PreserveNewest" />`（commit 73109cf，已推送，PR #68 自动更新）。

部署形态：
- `dotnet publish -r linux-x64 --self-contained`（116M，免装 .NET 运行时）→ tar.gz 49M → S3 `stayright-dev-raw` 桶 `deploy/` 前缀 → 预签名 URL → SSM RunCommand 安装到 `/opt/stayright/api`。
- env 放 `/opt/stayright/.env`（600 权限，DotNetEnv 从 cwd/.. 加载）：`POSTGRES_DB=stayright`、`POSTGRES_PASSWORD`、`INGEST_SHARED_KEY`。
- systemd `stayright-api.service`：`ASPNETCORE_URLS=http://0.0.0.0:5080`、Production、Restart=always、After=docker.service；pg 容器已设 `--restart unless-stopped`。
- 排障时将 `stayright` 库 drop+recreate（OWNER app）后干净首启：迁移+种子完整（12 用户、2 种子扰动），服务稳定 active。
- EC2 本机冒烟：匿名 403 正常；ingest 带真实密钥 POST → 200，库中 disruptions=3。

#### B2：Elastic IP ✅

- 分配 `eipalloc-061ca2ff858274fcc`，绑定 `eipassoc-00640ce7492ca75e1`，实例固定公网 IP = **32.237.54.103**（原自动分配 IP 15.134.136.245 已失效）。

#### B3：前端构建上传 site 桶 ✅

- 构建命令 `VITE_API_BASE_URL="" npm run build`——空串使 `client.ts` 的 `??` 不落默认值，fetch 走同源相对路径 `/api/*`，与未来任意域名（CloudFront）解耦；产物 grep 确认无 `localhost:5080` 残留。
- 上传 `stayright-dev-site-990393187001`：hash 资源 `Cache-Control: public,max-age=31536000,immutable`，`index.html`/`favicon.svg` 用 `no-cache`（保证发版即生效）。
- ⚠️ 教训：`aws s3 sync --delete`（全桶）误删了 8/21 冒烟遗留 `releases/smoke-20260821-015908.tar.gz`（3.3KB，桶未开版本控制，不可恢复，无业务价值）。以后对 site 桶同步应限定 `dist/` 前缀或不用 `--delete`。
- 桶为私有（Block Public Access），公网访问待 B4 的 CloudFront+OAC。

#### B4：CloudFront 分发 ✅（2026-08-27）

- 分发 ID `E3CNDKHDSY3D1I`，公网地址 **https://d2y6g16anevc6h.cloudfront.net**（默认证书，约 2.5 分钟 Deployed，PriceClass_200 含悉尼）。
- 结构：`/` → S3 `stayright-dev-site`（OAC `E2QRLKXSOLANI` sigv4 私有回源 + CachingOptimized + Compress）；`api/*` → EC2（DomainName 用 **`ec2-32-237-54-103.ap-southeast-2.compute.amazonaws.com`**，HTTP:5080，CachingDisabled + OriginRequestPolicy=AllViewerExceptHostHeader 转发 cookie/查询串/头，允许全部 7 种方法）；403/404 → `/index.html` 200（SPA 路由）；DefaultRootObject=index.html；Viewer 全部 redirect-to-https。
- 桶策略：仅允许 `cloudfront.amazonaws.com` 以 `AWS:SourceArn` = 本分发 ARN 读 `s3:GetObject`。
- EC2 `/opt/stayright/.env` 已加 `FRONTEND_ORIGIN=https://d2y6g16anevc6h.cloudfront.net` 并重启，服务 active。
- 验证：`GET /` → 200；`GET /login` → 200（SPA 错误映射生效）；`/api/*` 暂不通（安全组未放行，属 B5 范围，符合预期）。
- 两个 CLI 踩坑记录：① CloudFront 源站域名**不接受裸 IP**，用 EC2 公网 DNS 名（`ec2-<ip 反转>.ap-southeast-2.compute.amazonaws.com`）替代；② 托管策略 ID 不能凭记忆写——`CachingDisabled` 实为 `4135ea2d-6df8-44a3-9df3-4b5a84be39ad`、`AllViewerExceptHostHeader` 实为 `b689b0a8-53d0-40ab-baf2-68738e2966ac`，先 `list-cache-policies` 查再填。

#### B5：安全组放行 CloudFront ✅ + B4 错误映射修正（2026-08-27）

- SG `sg-08230019927292dac` 新增 ingress：TCP 5080，来源 = CloudFront 托管前缀列表 `pl-b8a742d1`（`com.amazonaws.global.cloudfront.origin-facing`，规则 `sgr-0f9802d21c66fe23c`）。API 端口不对公网裸开，仅 CloudFront 回源可达。
- **B4 配置缺陷修正**：原分发的 403/404→index.html 错误映射是分发级的，会把 C# API 的合法 403/404 响应（如匿名 `/api/auth/me` 的 403 JSON）替换成 index.html/200，破坏 API 语义（响应头露馅：`server: AmazonS3` + `x-cache: Error from cloudfront`）。修正：删除 CustomErrorResponses，改用 **CloudFront Function `stayright-spa-rewrite`**（cloudfront-js-2.0）挂默认（静态站）行为 viewer-request——非 `/api/`、路径最后一段不含 `.` 的 URI 重写为 `/index.html`，SPA 回退与 API 彻底隔离。
- 修正后验证：`/api/auth/me` → **403 JSON（1s）**；`/login` → 200（函数重写）；静态资产 200；`POST /api/auth/login`（coord1）→ **Login successful**。全量失效缓存 `/*` 已执行。
- CLI 踩坑：`authorize-security-group-ingress` 加前缀列表来源必须走 `--ip-permissions '…PrefixListIds=[{PrefixListId=…}]'`，没有 `--source-prefix-list-id` 这个简写；`cloudfront create-function --function-code` 要 **base64**。

#### 下一步（未做）

- ~~B3/B4/B5~~：当天已完成（见上方各节执行记录）。剩余线 A 与演示前事项，以「2026-08-27（晚）」一节的记录为准。

---

### 2026-08-27（晚）：线 A Lambda 探测管线（A1–A5）执行记录

#### 产物

- 新增 `detect/template.yaml`（SAM）：一个栈建齐四件事——SSM 参数 `/stayright/dev/API_BASE_URL`（A1）、weather-collector Lambda（A3，python3.12 / arm64 / 256MB / Timeout 120s）、执行角色（A5，`ssm:GetParameter` + `secretsmanager:GetSecretValue`，限定 `/stayright/{Stage}/` 前缀）、EventBridge Scheduler `stayright-dev-weather-collector`（A4，rate(15 minutes)、Pacific/Auckland、FLEXIBLE 5 分钟）+ Scheduler 回调角色。
- 新增 `detect/requirements-lambda.txt`：Lambda 包只装 requests + pydantic（boto3 运行时自带），完整 requirements.txt（pytest/psycopg 等）不进包。
- `detect/src/runtimes/lambda_weather_collector.py` 加一行：根 logger 设 INFO（Lambda python3.12 运行时默认 WARNING，不放开则 CloudWatch 看不到 done 日志行）。
- 栈名 `stayright-dev-weather-collector`，部署产物走 `stayright-dev-raw-990393187001` 桶 `sam/` 前缀。

#### 构建/部署命令（⚠️ `--manifest` 必带）

```bash
cd detect
sam build --use-container --manifest requirements-lambda.txt
sam deploy --stack-name stayright-dev-weather-collector \
  --s3-bucket stayright-dev-raw-990393187001 --s3-prefix sam/ \
  --capabilities CAPABILITY_IAM --region ap-southeast-2 --no-confirm-changeset
```

#### 踩坑记录

- 本机原本没有 SAM CLI（`brew install aws-sam-cli`，v1.165.0）；`sam build --use-container` 要求 Docker Desktop 在运行。
- Apple Silicon 上给 Lambda 打含 pydantic（编译型）的包必须 `--use-container`（产出 linux aarch64 的 `.so`）；函数设 `arm64` 让容器原生构建、无需模拟。
- 函数资源上的 `Metadata: PythonRequirementsFile` **不被 SAM 采纳**（不报错、静默回退 requirements.txt，打出 67MB 胖包）；必须用 `sam build --manifest requirements-lambda.txt`（瘦身后 9.2MB）。
- `AWS::Scheduler::Schedule` 的 `FlexibleTimeWindow` 必须带 `Mode: FLEXIBLE`，否则 changeset 报 `AWS::EarlyValidation::PropertyValidation`，且 stack events 里查不到细节。

#### 冒烟结果（全绿）

1. `aws lambda invoke` 手工触发 → 返回 `{"ingested": 1}`，Duration ≈6.8s / 内存 117MB；CloudWatch 出现 `{"evt": "weather_collector.done", "ingested": 1}` 日志行。
2. EC2 Postgres：disruptions 3 → 5（两次手工触发各 +1）；新行 `Storm near Wellington`（type=weather、severity=medium、影响窗口 2026-08-26T05:00Z → 08-28T05:00Z、raw_signal_text 含 Open-Meteo 阵风 91.1 km/h ≥ 90 阈值）。
3. 公网验证：coord1@example.com / Password123! 登录 https://d2y6g16anevc6h.cloudfront.net（identifier 须用邮箱或昵称 "Coordinator One"，裸 `coord1` 不行），`GET /api/coordinator/disruptions` 返回 5 条，含 Storm near Wellington。

至此线 A 全链路上线：Scheduler → Lambda → SSM/Secrets → Open-Meteo → 分类 → CloudFront → C# ingest → Postgres → 公网运营台可见。

#### 已知缺口 / 后续决策

- **无去重**：预报持续有风险期间，同一场风暴每 15 分钟会被重复 ingest（约 4 条/小时）。对应 open issue #31（Add De-duplication）。演示前要么实现去重，要么把模板参数 `ScheduleExpression` 改成低频（如 `rate(1 day)`）重新 `sam deploy`，或删除 `WeatherCollectorSchedule` 资源。
- Lambda 包当前连带 detect 的 tests/、scripts/ 目录（几十 KB，无害），有需要再瘦身。
- 演示前其余事项不变：SES 收件邮箱验证、浏览器全流程走查、PR #68 合并、EC2 停机评估。

---

### 更新记录

| 日期 | 变更 |
|---|---|
| 2026-08-24 | 建立本文件；记录 Gate CI 搭建、架构现状排查、探测→C# 建案最小桥接方案的设计与实现 |
| 2026-08-27 | 合并 Test → Dev-Zachary：目录重组跟随、`build_disruption_event` 新签名适配、全量测试通过 |
| 2026-08-27 | AWS 云端资源实测盘点（SSM/Secrets/S3/EC2/SES/Lambda/Scheduler/CloudFront）；EC2 数据库实机核查（Docker 容器 `pg`、库 `stayright` 空库待建表）；决策：手动部署先行、库名 stayright；部署计划定稿（P1/P2 → 线 B → 线 A） |
| 2026-08-27 | 线 A Lambda 探测管线（A1–A5）SAM 一栈部署上线，冒烟全绿（Lambda→C# 建案→公网运营台可见）；记录 SAM 踩坑与去重缺口 |

---

### 2026-08-27（深夜）：端到端业务闭环走查 + SES 邮件 + AI 双路降级

#### 目标与结论

验证完整业务闭环：**信号检测 → AI 生成计划 → 邮件发给 customer + hotel supplier**。全部跑通。

#### SES SMTP（关键踩坑）

- 后端邮件走通用 SMTP（MailKit），不直接调 SES API——用 SES 的 SMTP 端点即可。
- **派生算法踩坑**：初始 HMAC key 必须是 `"AWS4" + secret`（SigV4 标准），漏了 `"AWS4"` 前缀则 535 Authentication Credentials Invalid，且两个区域都失败。对照 `docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html` 伪代码第 14 行 `kDate = HmacSha256(date, "AWS4" + key)` 定位。
- 新建最小权限 IAM 用户 `stayright-smtp`（内联策略：悉尼区 `ses:SendRawEmail`/`ses:SendEmail`），派生 SMTP 凭证配到 EC2 `/opt/stayright/.env`：
  `SMTP_HOST=email-smtp.ap-southeast-2.amazonaws.com` `SMTP_PORT=587` `SMTP_SECURE=false` `SMTP_FROM=szha564@aucklanduni.ac.nz`；同时补 `FRONTEND_BASE_URL=https://d2y6g16anevc6h.cloudfront.net`（邮件里案件链接用，默认是 localhost）。
- SES 沙箱：已验证身份仅 `szha564@aucklanduni.ac.nz`。演示 guest（Alice）邮箱改为该地址；酒店端通知是站内的（不发邮件），无需改。

#### AI 双路降级（Gemini → Bedrock Haiku）

- C# 仓库原本**没有** Bedrock 代码（8/21 的 Bedrock 冒烟是 Python/环境侧）。补：`AWSSDK.BedrockRuntime` NuGet、`GeminiClient.GenerateAsync` 改为先 Gemini、失败/未配置时降级 Bedrock Converse（`BEDROCK_MODEL_ID` env = SSM 同值 `au.anthropic.claude-haiku-4-5-20251001-v1:0`），凭证走 EC2 实例角色（已含 AmazonBedrockFullAccess）。两条路都失败才返回 null 走降级文案。
- 顺带修 NU1605：Serilog.Sinks.Console 6.0.0 → 6.1.1（Serilog.AspNetCore 10 要求 ≥6.1.1，warning-as-error 会挂 build）。
- **实测**：临时把 GEMINI_API_KEY 改坏 → 日志出现 `Gemini API returned BadRequest…; trying Bedrock fallback` → `AI reply generated via Bedrock au.anthropic.claude-haiku-4-5-20251001-v1:0`，Alice 正常收到 AI 回复 → 恢复真 key。
- 部署沿用 B1 管线：publish → tar.gz（50M）→ S3 `deploy/` → 预签名 URL → SSM 安装 `/opt/stayright/api` → restart（服务 active，匿名探活 403 正常）。

#### 端到端走查（API 驱动 + 数据库/日志佐证，浏览器仅深链视觉验证）

用 **B1 Smoke Storm**（Queenstown，窗口 8/27–9/26 覆盖 9 月种子预订；真实 Wellington 风暴的候选为 0，因无 Wellington 酒店）：

| 步骤 | 动作 | 结果 |
|---|---|---|
| 1 | 协调员 Notify Alice 预订（CONF-0001） | 案件 6d0a61ca 建案，分给 Coordinator One；**邮件 1** `Your booking may be affected` 发出 |
| 2 | 协调员生成+推送选项 | 3 选项（顺延+3天 / 换 Rotorua -90 NZD / 取消退款 486）；**邮件 2** `New rebooking options are ready` 发出 |
| 3 | 酒店登录确认 defer 询单（新日期 9/8–9/11） | 触发**邮件 3** 通知 Alice 酒店已确认 |
| 4 | Alice 发消息问 storm/延期价格/接驳 | **Gemini 回复**（语境正确） |
| 5 | Alice 选 defer + 确认执行 | 自动重订：新确认号 CONF-34EEB61F、日期 8/29–9/1 |
| 6 | 案件终态 | Completed；数据库 7 条通知全 success（2 邮件 + 5 站内） |

SES 统计：24h 发送 6 封、0 拒绝/0 投诉/0 退信（`aws ses get-send-statistics`）。

#### 浏览器验证说明（IAB 限制）

桌面 IAB 的**元素点击事件派发不可靠**（Playwright/DOM/CUA 坐标点击都出现命中偏移或延迟，约 1.15x 视口缩放错位；登录表单回车可用、深链导航可靠）。已确认：协调员登录、Dashboard/队列渲染、案件页 Completed + AI conversation 徽标 + 更新后日期。未做完整 GUI 点击流；建议演示前用真人浏览器或修 IAB 兼容再走一遍纯 GUI 流程。

#### 遗留事项

- 无去重（#31）：Scheduler 每 15 分钟持续入库，Wellington 风暴已 6+ 条，演示前处理或降频。
- SES 沙箱：演示前建议再验证 1–2 个真实收件邮箱 + 提交出沙箱申请（免费）。
- Alice 邮箱已改线上库（`szha564@aucklanduni.ac.nz`），种子文件 `users.json` 未改（避免污染未来部署）；演示若重置库需重改。

### 更新记录

| 日期 | 变更 |
|---|---|
| 2026-08-27 | 线 A Lambda 探测管线（A1–A5）SAM 一栈部署上线，冒烟全绿（Lambda→C# 建案→公网运营台可见）；记录 SAM 踩坑与去重缺口 |
| 2026-08-27 | 端到端业务闭环走查全通（检测→AI→邮件→重订）；SES SMTP 打通（AWS4 派生坑）；AI Gemini→Bedrock Haiku 双路降级上线并实测；IAB 浏览器点击限制记录 |

---

### 2026-08-27（续）：邮件 NDR 战争 + 收件切换 Gmail + 数据库重置（队友 dump）

#### 邮件 NDR：DMARC 拒收诊断与修复（重要运维故事）

- **现象**：SES 报告全部「投递成功、0 退信」，但收件箱里堆满 "Delivery has failed to these recipients"（NDR 退信）——大学邮箱把邮件拒了，NDR 退给发件人自己。
- **根因（DNS 证据）**：`aucklanduni.ac.nz` 的 SPF 为 `-all`（硬失败）且**不含 SES**，DMARC 为 **`p=reject; sp=reject; adkim=s; aspf=s`**（严格对齐 + 直接拒收）。SES 以大学地址做 From，SPF/DKIM 双失败 → Google（大学 MX 是 aspmx.l.google.com）按 DMARC 拒收。
- **教训**：`get-send-statistics` 只统计 SES 的发送尝试（250 OK），**收件方拒收后的 NDR 走另一条路回发件人，SES 看不到**——「SES 绿灯」≠「送达」。邮件可投递性必须端到端验证（真实收件箱确认）。
- **修复路线（团队拍板：SES 换发件人，不走大学 SMTP）**：
  - 排查了常见邮箱域的 DMARC 策略：gmail/outlook/163 = `p=none` 可用；qq/icloud/proton = `quarantine`（进垃圾箱）；**yahoo = `p=reject` 同样不可用**。
  - 新建 SES 发件身份 `zacharyzhang2088@gmail.com`（邮箱验证流程）→ EC2 `.env` 改 `SMTP_FROM` → 重启。
  - 效果：不再 NDR；首轮进 Gmail 垃圾箱，收件人标记「非垃圾」后进收件箱。

#### 收件人整体切换到 Gmail

- Alice（guest 演示账号）线上库邮箱改 `zacharyzhang2088@gmail.com`（ university 域被 DMARC 拒、其它 guest 是 @example.com 沙箱发不出）。
- 真实业务邮件三连验证（Gale Warning 案件）：Notify → `Your booking may be affected`；Push 选项 → `New rebooking options are ready`；酒店确认 → `The hotel confirmed your option/request`。全部经 SES 发到 Gmail，后端日志逐条确认。

#### 第二轮端到端验证（Gale Warning，全 GUI 手动）

- 注入 `Queenstown Gale Warning`（窗口 8/28–9/1 精确覆盖 Alice 重订后的 8/29–9/1 预订）→ 协调员/酒店/客人三门户全 GUI 手动走查。
- **AI 对话实测**：客人 3 条消息，Gemini 均 ~2s 回复（数据库 messages 表留痕）。
- **客人选 defer**（selected=t 落库）→ 执行被拦截："This case has already been resolved"——**不是 bug**：`CONF-34EEB61F` 状态已是 rebooked，后端保护规则「一预订只能重订一次」正确拒绝。第一轮验证的重订成果即本规则的物证。
- 顺手真实触发一次 weather Lambda（`aws lambda invoke` → `{"ingested":1}`），确认手动触发与 Scheduler 行为一致（Wellington 风暴，非模拟数据）。

#### 数据库重置：导入队友本地 dump（`kakapo_full_dump_overwrite.sql`）

- 背景：Yang 提供其本地库完整覆盖式 dump（pg_dump 16.14，结构+数据，含 handoff 演示案件），要求更新 EC2。
- 流程：**先备份**（`pg_dump` → EC2 /tmp + S3 `backups/stayright_backup_20260827_0234.sql` 双份）→ dump 经 S3 中转上传 EC2 → `docker exec -i pg psql -U app -d stayright -v ON_ERROR_STOP=1` 导入 → 验证。
- **踩坑（必须告诉团队）**：新版 pg_dump（16.14）在文件首尾写 `\restrict` / `\unrestrict` 安全元命令，EC2 容器的 psql 客户端是 **16.4**（不认识，报 `invalid command`）。头部那条会让导入直接失败（幸好）；尾部那条在全部语句执行完才报（数据实际已导入成功）。**解法：删除首尾两行 `\restrict`/`\unrestrict` 再导**，或升级容器 psql。
- 导入结果：users=16 / cases=1 / bookings=13 / disruptions=3（与队友本地一致）。今天上半夜的走查数据（Gale Warning 案件、Wellington 风暴系列）已被覆盖——回滚备份在 S3。
- 善后：Alice 邮箱再次改回 `zacharyzhang2088@gmail.com`（dump 把它带回 alice@example.com）。

#### 演示材料（同期产出，不在仓库）

- PPT v3（桌面 `StayRight_Presentation_v3.pptx`）：在 v2 风格系统上追加 2 页——「AWS Reference Architecture — Test Environment」（三层数据流架构图）+「Where We Stand」（交付时间线 + 实测清单 + NEXT UP）。日期方块标注 AUG 21/24/27。
- 动态数据流演示页（`778/03-方案与交付/AWS 架构设计方案/StayRight-NZ_AWS-MVP-Live_数据流动态图_v1_0.html`）：仿团队 v2.4 交互框架（SVG + 分步动画 + 场景切换），内容为当前 MVP 实测状态；三个场景（端到端 / AI 双路降级 / 访问与安全），单行字幕 + layer 背景随步骤高亮 + 一屏自适应布局。踩坑：IAB 内嵌浏览器点击派发不可靠且不支持 file://，演示请用真实浏览器全屏打开。

### 更新记录

| 日期 | 变更 |
|---|---|
| 2026-08-27 | 邮件 NDR 根因定位（大学域 DMARC p=reject）与修复（SES 换验证过的 Gmail 发件人）；收件人切 Gmail；第二轮全 GUI 端到端验证（含 rebooked 保护规则拦截实测）；导入队友 dump 重置数据库（psql 16.4 不认 \\restrict 的坑） |
| 2026-08-27 | Test 合并版（f9511ae）全量部署上线：后端 EC2 原子换目录 + 前端 site 桶更新 + CloudFront 失效；Lambda handler 无变化跳过；冒烟全绿，线上库（队友 dump 后状态）未动 |

---

### 2026-08-27（傍晚）：Test 合并版（f9511ae）全量部署

#### 范围判定

- 本地 `Dev-Zachary` 已合并 Test（f9511ae，+1508/−257，34 文件）：后端（CaseService 建案开场白+提议日期、EmailTemplate 美化邮件、HandoffIngestJob、DisruptionRepository/Service）与前端（Coordinator 面板重构、OptionsFlowPage、Hotel 页）均有实质变更 → **后端、前端都要重新部署**。
- `detect/` 自上次 SAM 部署仅新增 `dedup.py`、改 `run_demo.py`，`lambda_weather_collector.py` handler 及其 import 链（open_meteo/models/adapters）**零变化** → Lambda/Scheduler 栈跳过，未重部署。dedup 尚未接线到 handler，#31 去重缺口仍在。
- 合并未含新 EF 迁移（Migrations 无 diff），线上库 schema 无变化；部署不触碰 `/opt/stayright/.env`（Gmail 发件人、GEMINI/Bedrock 等 .env 配置全部保留）。

#### 执行

- 后端：`dotnet publish -c Release -r linux-x64 --self-contained`（117M）→ `deploy/stayright-api-testmerge-20260827-175141.tar.gz`（50M）→ SSM RunCommand **原子换目录**：解压到 `api.new` → stop → `api`→`api.old`（回滚点）→ `api.new`→`api` → start。服务 active，启动日志干净（迁移+种子正常，无重启循环）。
- 前端：`VITE_API_BASE_URL="" npm run build`（JS gzip 114KB；CSS 89.7KB，Coordinator 面板样式大幅增量）；新 hash 资产 `immutable` 上传、`index.html`/`favicon.svg` `no-cache`；**未用 `--delete`**（沿用 8/27 教训，旧 hash 资产留存无害）；CloudFront 失效 `/*`（`I5S8D0RZZXM4HPIRUSFD1B8YB`）。

#### 验证（全绿）

公网 `https://d2y6g16anevc6h.cloudfront.net`：`GET /` 的 index.html sha1 与本地构建逐字节一致（`6c40c787…`）；匿名 `/api/auth/me` 403；coord1 登录成功；带 cookie `GET /api/coordinator/disruptions` 200，数据与队友 dump 后的库一致（Wellington 风暴在列）。

#### 观察与遗留

- 新代码 `HandoffIngestJob` 启动监听 `/opt/stayright/detect/output/handoff.jsonl`，该目录 EC2 上不存在，每 15s 重试 watcher——非报错；若要启用 handoff 集成需在 EC2 建目录（队友 dump 里已有 handoff 演示案件数据）。
- 回滚方式：EC2 上 `systemctl stop stayright-api && rm -rf /opt/stayright/api && mv /opt/stayright/api.old /opt/stayright/api && systemctl start stayright-api`。

---

### 2026-08-27（晚）：演示数据预置（8/28 演示用）

- 清理 Wellington 重复扰动：18 → 4 条（Scheduler 无去重又刷了 14 条，DELETE 保留最新 1 条；**演示当天早上若又积累需再清**）
- 插入 Alice 演示预订：`CONF-DEMO01`，Rotorua Thermal Hotel，2026-09-05 → 09-07，480 NZD，confirmed（SQL INSERT，room_type Standard Twin）
- 经真实 ingest API 注入演示风暴 `Spring Storm - Rotorua`（9/4–9/8，disruption id `dd342f66…`）——和 Lambda 同一条管线入口
- coord1 notify Alice → 案件 `86ed0913…`（pending / high / 已分配 Coordinator One），开场白+站内通知+SES 邮件（Gmail 收件箱可查）已生成；**3 个 AI 选项已生成未推送**（defer+3天 / 换 Test Auckland CBD Hotel / 取消退款 432）
- 酒店侧 defer 询单已自动创建（hotel2 待处理列表可见）
- 回滚：`DELETE FROM bookings WHERE confirmation_no='CONF-DEMO01'; DELETE FROM disruptions WHERE id='dd342f66-4d47-46f1-bdbd-b978ffe523a6';`（案件/选项随 FK CASCADE）
- ⚠️ 演示前**任何人不得重置线上库**，否则需重跑本节预置

---

### 2026-08-27（晚）：一键演示注水脚本 `scripts/seed-demo-case.sh`

#### 背景

演示前需要一条可重复执行的"注水"命令：跑一次，让 Coordinator / Guest(Alice) / Hotel(Rotorua Thermal) 三页同时出现待办，直接开演。此前手工预置的案子（86ed0913）已按指令关闭，无法复用。

#### 关键发现：同一"扰动×预订"组合永远只进一次候选

`DisruptionRepository.ListCandidateBookingsAsync` 有 `!db.Cases.Any(c => c.BookingId == b.Id && c.DisruptionId == disruption.Id)` 条件——**已关闭的案件也计数**。所以种子扰动 `Spring Storm - Rotorua` 建过一次案子后就再也无法为 Alice 出候选（实测 candidates 返回空数组）。可重复演示的唯一入口是每次用 ingest 接口新建扰动，正好对应 Lambda 在真实管线里的角色。

#### 脚本行为（与协调员 UI 手工操作等价）

1. 登录 coord1 → 关闭该客人遗留未结案件（幂等，重跑不堆积）
2. `POST /api/ingest/disruptions` 新建 `Demo Storm - Rotorua <HH:MM>`（窗口默认 9/5→9/9，覆盖 Alice 罗托鲁瓦预订 +12/+14 天偏移；`WINDOW_START/WINDOW_END` 可覆盖）
3. 候选匹配 → notify：自动建案（least-busy 分配）+ 客人站内通知 + 原酒店 defer 询单
4. options regenerate + push：客人端出现 3 张方案卡片与铃铛通知
5. 分别以三个角色登录核验并打印各页应见内容

#### 踩坑记录

- ingest 的 `CreateDisruptionRequest` 是 **PascalCase 记录 + System.Text.Json 默认绑定**，JSON 字段需 camelCase/PascalCase；snake_case 会报 400 "RawSignalText field is required"（其余字段静默绑不上不报错，只有 required 字段会暴露）。
- 客户端通知列表返回分页字段是 `data.list` 不是 `items`。
- ingest 密钥存在 `scripts/.env.demo`（`.gitignore` 的 `.env.*` 已覆盖），源是 Secrets Manager `stayright/dev/ingest/shared-key`。

#### 线上当前状态（脚本实跑两轮验证）

- 最新演示案 `3ff6fc8c-e6c5-4191-a19b-dd774e7a41ea`（Alice / Demo Storm - Rotorua 21:42 / pending / high / 方案 3 张已推送）
- hotel2 待办仅 1 条 defer 询单（首条孤儿询单已 confirm 清理）
- 扰动列表累计多条 Demo Storm——正式演示前建议仍执行一次重复扰动清理 SQL

---

### 2026-08-27（深夜）：完整链路演示脚本 `scripts/seed-demo-full.sh`

#### 与直注脚本的关系

`seed-demo-case.sh`（直注模式）脚本扮演 Lambda；本脚本让 **Lambda 真实触发**：`aws lambda invoke` → CloudWatch 日志（脚本自动抓取并打印最新 `weather_collector.done` 行）→ Open-Meteo 真实预报决定 ingest 哪座城 → 候选匹配 → 建案 → 方案推送 → 三端核验。演示时 CloudWatch Live Tail 与本脚本同屏即是"探测"证据。

#### 关键背景：Lambda 只监测四城，Alice 原预订接不住

`DEFAULT_LOCATIONS = Queenstown / Auckland / Wellington / Christchurch`（region 字段=城市名，候选匹配按酒店地址 ILIKE 城市名）。Alice 原有预订在 Rotorua（不在监测列表）和 Queenstown（日期 +10/+13 天偏移，与预报窗口不保证重叠）。真实天气不可控——7 天预报内只有 Wellington 阵风 ≥90 km/h（窗口至 9/2），QZN/AKL/CHC 峰值仅 ~70。

#### 桥接资产（经 SSM RunCommand 写线上库，全部幂等）

- 新酒店 **Wellington Waterfront Hotel**（地址含 Wellington，id `ecd7e7a5-c13c-4709-97cf-96842bfaa677`）+ 房型 Harbour View Queen
- 三条桥接预订 `CONF-DEMO-WLG/ZQN/AKL`（Alice 名下；**日期动态**：每次运行 upsert 为"明天入住住 5 晚"，保证与任何近期预报窗口重叠；初版用固定宽日期 8/1→12/31 导致方案卡片出现"住 155 晚/价差 -21128"的荒谬数字，已改）
- **酒店账号 repoint**：`yangdongqing214@gmail.com`（昵称仍是 "Test Hotel Auckland"）的 `hotel_id` 从 Test Auckland CBD Hotel 改挂 Wellington Waterfront Hotel——因为种子酒店用户只有 Queenstown/Rotorua/Test Auckland 三家，惠灵顿没有酒店账号可登

#### 脚本行为

关闭 Alice 遗留案件 → upsert 桥接预订 → invoke Lambda + 抓 CloudWatch 日志行 → 扰动快照 diff 找新增 → 新增扰动的候选里找 `CONF-DEMO-*` → notify 建案 → regenerate+push → 三端核验。**兜底**：若真实天气没触发任何有桥接预订的城市（如只有 Wellington 且桥接被删、或零风险窗口），自动回退直注 Rotorua 并明确标注"回退模式"，演示永不空场。回退时酒店节拍登录 Rotorua Thermal Front Desk。

#### 实跑结果（2026-08-27 深夜）

Lambda 真实触发全链路走通：Wellington 风暴 → CONF-DEMO-WLG 命中 → 案件 `425b7809…` → 方案 3 张已推送 → WLG 酒店账号询单 1 条。

#### 演示注意

- 客人选 **defer（改期）** 时，酒店节拍在 `yangdongqing214@gmail.com`（Wellington Waterfront 前台视图）确认；选 **alternate** 时换房确认会落到 Rotorua Thermal（hotel2）名下——两个节拍别串台
- defer 询单在**建案时**就自动落库（不等客人选择）；"客人选 defer → 酒店确认 → 客人确认执行"的完整两阶段在线上还没排练过，演示前务必走一遍
- 回滚（如需拆除惠灵顿桥接）：
  ```sql
  UPDATE users SET hotel_id=(SELECT id FROM hotels WHERE name='Test Auckland CBD Hotel') WHERE email='yangdongqing214@gmail.com';
  DELETE FROM cases WHERE booking_id IN (SELECT id FROM bookings WHERE confirmation_no LIKE 'CONF-DEMO-%');
  DELETE FROM bookings WHERE confirmation_no LIKE 'CONF-DEMO-%';
  DELETE FROM room_types WHERE hotel_id=(SELECT id FROM hotels WHERE name='Wellington Waterfront Hotel');
  DELETE FROM hotels WHERE name='Wellington Waterfront Hotel';
  ```
- 每次运行还会新增一条 Lambda 探测的 Wellington 重复扰动（无去重，issue #31），清理 SQL 见 2026-08-27（晚）一节

#### 补记（同晚稍后）

- 演示发现酒店页右上角显示的是**账号昵称**（"Test Hotel Auckland"），与惠灵顿酒店视图不符。已把该账号昵称改为 **"Wellington Waterfront Front Desk"**（登录请用邮箱 `yangdongqing214@gmail.com`，原昵称已不再可登录）。回滚时除下述 SQL 外还需恢复昵称。

#### 补记 2：演示清场脚本 `scripts/clean-demo-state.sh`

- 用途：演示前把三端 pending 全部清干净——①关闭所有未结案件（含非 Alice 的）②resolve 全部 Demo Storm / Storm near Wellington 扰动（顺带解决了重复风暴刷屏，无需再手工跑 DELETE SQL）③Alice 通知全部已读 ④三家酒店 pending 询单与换房方案逐条确认
- 全部走正式 API（search 接口的 q 参数含空格需 URL 编码，"Test Guest1" 曾致 curl exit 3，已修）
- 顺带把 8/27 当天积累的 33 条重复惠灵顿扰动全部 resolve，扰动画板恢复干净
- **注意顺序**：Scheduler 每 15 分钟仍会灌新的 active 风暴，所以正确顺序是 清场 → 立即注水 → 开演；清场后超过半小时才开演的话面板会再积 1-2 条（不影响功能，略影响整洁）

#### 补记 3：清场脚本"确认询单不生效"根因修复（重要）

- 症状：clean-demo-state.sh 报成功但酒店端询单仍是 pending，前后出现三次；手工 curl 同一接口却每次都成功
- 根因：`api()` 的约定是**第 3 个参数就是 JSON body**，但酒店询单确认那行写成了 `api POST "url" -H "..." -d '{...}'` 六个参数——函数只取到 $3="-H"，实际发出的请求体是字符串 `"-H"`，后端模型绑定 400；而 `assert_ok` 的报错输出又被 `>/dev/null` 吞掉，成功横幅照打，形成"假成功"
- 修复：①确认调用改为单 $3 传 body；②assert_ok 错误改走 stderr 并保留校验；③step 4 保持"确认→重拉→归零才放行"的自验证循环（本轮实测第 1 轮即归零）
- 教训：所有包装 curl 的辅助函数都要明确剩余参数透传语义；assert 类函数的错误绝不能重定向丢弃

### 更新记录

| 日期 | 变更 |
|---|---|
| 2026-08-27 | 演示数据预置、一键注水脚本（`seed-demo-case.sh` / `seed-demo-full.sh`）、清场脚本（`clean-demo-state.sh`）及其踩坑修复 |
| 2026-09-02 | 补齐 volcano / flight / road 三个 Lambda 采集器（运行时外壳 + 13 条测试 + `detect/template.yaml` 扩成 4 采集器一栈）；本地全绿（pytest 90、SAM lint、三种 ingest payload 200）；**未部署**，待 Zachary `sam deploy` + 填 `oag/api-key` |

---

### 2026-09-02：补齐 volcano / flight / road 三个采集器（代码 + SAM，未部署）

#### 背景

`detect/` 此前只有天气一个采集器上线（线 A，2026-08-27）。队友已合并 volcano /
flight / road 三个探测源模块（commit `44b4635` → merge `3e5604e`：
`geonet_volcano.py` / `flight_status.py` / `nzta_road.py`，把 GeoNet VAL、机场
FIDS、NZTA 路网事件各自归一化成 `DisruptionEvent`），但只有探测逻辑，没有
Lambda 运行时外壳，也没进 SAM 模板。本次把 CLAUDE.md 既定的「4 采集器」从 1 个
补到 4 个。

#### 决策（与 Zachary 确认）

- 每个采集器各写一份 `ingest_disruption`，**不抽共享辅助函数、不动
  `lambda_weather_collector.py`**（保持其现有测试不受影响）。
- **flight key**：采集器读 `secret("oag/api-key")`；值为空时记 warning 并
  `return {"ingested": 0, "skipped": True}`，不报错。key 填上即生效
  （`fetch_flight_status` 目前仍打 AeroDataBox，将来换 OAG 只改那一个函数）。
- SAM：扩展现有 `detect/template.yaml`，同一个栈里加 3 函数 + 3 调度规则。
- 频率：三个都 `rate(15 minutes)`，与天气一致。

#### 产物（本地，未部署）

- 新增 `detect/src/runtimes/lambda_volcano_collector.py` / `lambda_flight_collector.py`
  / `lambda_road_collector.py`——结构照抄 `lambda_weather_collector.py`：
  `handler` 调 `detect_*_events()` → 逐个 `ingest_disruption` → POST
  `/api/ingest/disruptions`（payload 仍是 C# `CreateDisruptionRequest` 那 6 个
  字段：type/title/region/startAt/endAtOrWindow/rawSignalText，geo/severity 塞进
  rawSignalText）。失败让 `raise_for_status()` 异常上抛，不吞。
- 新增对应 3 个测试文件（镜像 `test_lambda_weather_collector.py`），共 13 条：
  payload 形状、`raise_for_status` 异常传播、handler 空结果/有结果分支，flight
  额外一条「oag/api-key 为空 → 跳过且不打网络」。
- `detect/template.yaml` 重写：抽出共享 `CollectorPolicy`（`ssm:GetParameter` +
  `secretsmanager:GetSecretValue`，限 `/stayright/{Stage}/*`）和
  `CollectorScheduleRole`（scope 到 4 个函数 ARN）；`Globals.Function` 收敛
  Runtime(python3.12) / Arch(arm64) / Timeout(120) / Mem(256) / STAGE；4 个
  `AWS::Serverless::Function` + 4 条 `AWS::Scheduler::Schedule`；Outputs 补 3 个
  新函数名。**栈名建议由 `stayright-dev-weather-collector` 改为
  `stayright-dev-detect-collectors`**——天气 Lambda 此前虽写过部署记录，但改名
  仅影响下次 `sam deploy` 的 `--stack-name`，需 Zachary 决定是新建栈还是沿用旧名
  更新（旧栈若已存在，改名会导致旧栈里的天气函数/调度被遗弃，需手动清理）。
- `requirements-lambda.txt` 无改动（requests + pydantic 已覆盖三个新源）。

#### 本地验证（全绿，未碰真实 AWS）

- `cd detect && .venv/bin/python -m pytest -q` → **90 passed**（原 77 + 新 13，无回归）。
- `python -m scripts.run_detect --simulate` → 四源各产出事件。
- `sam validate --lint` → valid SAM Template。
- 端到端 payload 校验：本地起 C# 后端（`.env` 加 `INGEST_SHARED_KEY=local-dev-ingest-key`
  并重启），volcano / road / flight 三种 payload 打 `POST /api/ingest/disruptions`
  均 **HTTP 200**，建出真实 Disruption 行。

#### 部署待办（Zachary，需凭证）

1. 定栈名（见上，`stayright-dev-detect-collectors` 还是沿用旧名）。
2. `cd detect && sam build --use-container --manifest requirements-lambda.txt`
   然后 `sam deploy --stack-name <定的名> --s3-bucket stayright-dev-raw-990393187001
   --s3-prefix sam/ --capabilities CAPABILITY_IAM --region ap-southeast-2 --no-confirm-changeset`。
3. 对 3 个新函数 `aws lambda invoke` 冒烟：平时预期 `{"ingested": 0}`；flight 在
   `stayright/dev/oag/api-key` 未填值时是 `{"ingested": 0, "skipped": true}`。
4. flight 要真正出数，需先把 Secrets Manager `stayright/dev/oag/api-key` 的值填上
   （目前 `docs/AWS_SDK_SPEC.md` §4.3 标「待填值」）。

#### 遗留 / 注意

- 去重缺口（issue #31）依旧：volcano/road 采集器同样每 15 分钟重复 ingest 同一
  持续事件。`dedup.py` 仍未接线到任何 handler。
- 外部 API 端点 URL 仍写在各 detect 模块的模块级常量里（与天气 `OPEN_METEO_URL`
  一致），未走 SSM 的 `SIGNAL_ENDPOINT_GEONET/NZTA/OAG` 三个预留参数；如果要统一
  从 SSM 读端点，另开改动。
- 本地为验证 ingest 给根 `.env` 加了 `INGEST_SHARED_KEY`（`.gitignore` 已覆盖
  `.env`，不会提交）。

---

### 2026-09-03：三轨全量部署完成（A 采集器 + B 后端 + C 前端）

#### 背景

`Dev-Zachary` 自 8/27 全量部署（`f9511ae`）以来累积了三块未上线改动：
volcano/flight/road 采集器（本次新写的 Lambda 外壳）、后端 19 文件 +2043 行
（含 1 个新 EF 迁移 `20260901231759_AddCaseWorkflowStateHistory`）、前端 16 文件
+656 行（协调台重构 + case transfer + case analytics + AppShell）。目标：全部上
dev 环境（EC2 + CloudFront + SAM 栈）。

仓库里此前**没有部署脚本**，8/27 那批是手动 SSM RunCommand。本次把后端/前端
部署固化成 `scripts/deploy-backend.sh` / `scripts/deploy-frontend.sh` 提交进仓库。

#### A. 采集器（SAM）— ✅ 已部署

- `sam build --use-container --manifest requirements-lambda.txt` +
  `sam deploy --stack-name stayright-dev-weather-collector`（沿用现有栈，同栈原地
  新增，不新建 `detect-collectors` 栈）。
- Changeset：新增 11 资源（`CollectorPolicy` 托管策略、`CollectorScheduleRole`
  共享调度角色、volcano/flight/road 各 Function+Role+Schedule）；改 4（weather
  函数及角色改挂共享策略、weather 调度 RoleArn 换共享角色、SSM 参数描述）；删 1
  （旧 `WeatherCollectorScheduleRole`）。weather 物理函数不变、无停机。
- **冒烟**：volcano `{"ingested": 0}` ✅；road `{"ingested": 1}` —— 真检测到
  NZTA 上 **SH94 Milford Sound 全封闭**，入库 disruption `54fa898b`（region
  "Milford Sound"，无当地酒店 → 0 候选、不建案；按 Zachary 决定保留在库里）；
  flight 初次 403 —— `oag/api-key` 在 Secrets Manager 里**非空**（8/21 创建即有
  值，从未更新），拿它打 AeroDataBox 被拒。
- **flight 修复**（commit `769a667`）：handler 捕获 `requests.HTTPError`，401/403
  视为"配置未就绪"跳过（同空 key），其余 HTTP 错误仍上抛。重新冒烟
  `{"ingested": 0, "skipped": true}` ✅。
- **调度频率**（commit `c361234`）：新增模板参数 `NewCollectorScheduleExpression`
  默认 `rate(1 day)`，volcano/flight/road 用它；weather 仍 `rate(15 minutes)`。
  原因：去重缺口 issue #31 未修，低频避免同一持续事件（如 SH94 常年封闭）被反复
  ingest。需要即时探测时手动 `aws lambda invoke`。已核验 4 条 schedule 频率生效。
- **踩坑**：改完 `template.yaml` 必须重跑 `sam build` —— `sam deploy` 用的是
  `.aws-sam/build/template.yaml`（构建产物），不是源模板。第一次改调度频率后直接
  deploy 报"No changes"，因为构建产物是旧的。
- **部署后的物理函数名**（冒烟 `aws lambda invoke` 用；栈 outputs 也有）：
  - weather `stayright-dev-weather-col-WeatherCollectorFunction-WFv67fLEC7UL`
  - volcano `stayright-dev-weather-col-VolcanoCollectorFunction-vFlTvhSjttNk`
  - flight  `stayright-dev-weather-coll-FlightCollectorFunction-oD233zIfT3xo`
  - road    `stayright-dev-weather-collec-RoadCollectorFunction-o0l6qDMEvODu`
- 调度频率核验：weather `rate(15 minutes)`；volcano/flight/road `rate(1 day)`，全部 ENABLED。

#### C. 前端（S3 + CloudFront）— ✅ 已部署

- `scripts/deploy-frontend.sh`：`VITE_API_BASE_URL="" npm run build` →
  `aws s3 sync dist/`（**不带 `--delete`**，8/27 教训）到
  `stayright-dev-site-990393187001`，hash 资源 `immutable`、index.html/favicon
  `no-cache` → `aws cloudfront create-invalidation E3CNDKHDSY3D1I /*`
  （`I8TLOBQYWUJFIBHEFS800SO9X1`）。
- **验证**：线上 `/` 的 index.html 指向新 hash `assets/index-CB-CGTj7.js` +
  `index-BpA8tN_g.css`（与本地构建一致，S3 桶里 2026-09-03 00:54 上传）、JS 资源
  200、`/api/auth/me` 匿名 403、coord1 登录 200。CSS 体积 8/27 的 ~90KB → 134KB
  （协调台新样式）。
- **本轮改动范围**：16 个文件全在 `features/coordinator/`（Dashboard 重构、
  AnalyticsDashboard、CasesPage、DisruptionLiveMap）+ `features/hotel/` 小改 +
  `shared/components/AppShell`。**`features/guest/` 零改动** —— 所以 `/guest/home`
  部署前后视觉一致是正常的，要看变化去 `/coordinator/home`。
- 旧 hash 资产（`index-_3RgW4sy.js` 等）仍留在桶里（没用 `--delete`），浏览器可能
  仍跑缓存旧版 → 硬刷新（Cmd+Shift+R）或无痕窗口。

#### B. 后端（EC2）— ✅ 已部署（Zachary 本机执行 `scripts/deploy-backend.sh`）

- 迁移 `20260901231759_AddCaseWorkflowStateHistory` 已在服务启动时自动应用
  （journalctl：`Applying migration '20260901231759_AddCaseWorkflowStateHistory'`
  → `Now listening on: http://0.0.0.0:5080` → `Application started`）；
  `systemctl is-active` = active，本机 `/api/auth/me` → 403。
- **公网验证**：coord1 登录 200；`GET /api/coordinator/disruptions` 200；
  新路由 `POST /api/coordinator/cases/{id}/transfer` 已生效（对不存在的 case
  返回 handler 的 `{"code":404,"message":"Case not found"}` JSON，非 SPA 兜底 404）。
- "case analytics" 是前端侧改动，无新后端接口。

`scripts/deploy-backend.sh`（照 8/27 的 B1 线重建）：

1. `dotnet publish TravelDisruptionAgent.Api.csproj -c Release -r linux-x64
   --self-contained -o backend/publish --property:TargetFramework=net9.0`
   （本机 SDK 是 .NET 10，必须 `--property:TargetFramework=net9.0` 锁目标；
   `backend/` 下 `.sln` + `.csproj` 并存，必须显式指定 `.csproj` 否则 MSB1011）
   —— 本地已试跑，产物 117M、ELF x86-64、rag 种子 .md 已带上（8/27 csproj 修复仍在）。
2. `tar czf` → `aws s3 cp` 到 `s3://stayright-dev-raw-990393187001/deploy/`
3. `aws s3 presign --expires-in 1800`（EC2 curl 预签名 URL，不需要 S3 读权限）
4. `aws ssm send-command AWS-RunShellScript` 到 `i-0d71260ab44ceb0c3`，远端脚本
   base64 传入，做**原子换目录**：
   `curl → 解压 /opt/stayright/api.new → systemctl stop → api→api.old（回滚点）
   → api.new→api → systemctl start → sleep 6 → is-active + 本机 /api/auth/me
   探活 + journalctl 抓迁移/启动日志`
5. 轮询 `get-command-invocation` 到非 InProgress，打印 stdout/stderr

- **不碰 `/opt/stayright/.env`**（Gmail 发件人、GEMINI/Bedrock key）。
- 迁移 `20260901231759_AddCaseWorkflowStateHistory`（新增表 `case_workflow_state_history`，
  非破坏性）在服务启动时由 `Program.cs` 的 `db.Database.MigrateAsync()` 自动应用。
- **回滚**：EC2 上 `systemctl stop stayright-api && rm -rf /opt/stayright/api
  && mv /opt/stayright/api.old /opt/stayright/api && systemctl start stayright-api`。

SSM `send-command` 被 Claude Code 安全分类器硬拦（在生产 EC2 上跑任意命令），
所以 A/C 由 Claude 直接 `sam deploy` / `aws s3 sync`，**B 由 Zachary 在本机跑
`./scripts/deploy-backend.sh`**（脚本内含 `aws ssm send-command`）。以后想让 Claude
代跑 B，需在 `.claude/settings.json` 加 `Bash(aws ssm send-command:*)` +
`Bash(aws ssm get-command-invocation:*)` 允许规则。

#### 本次提交（origin/Dev-Zachary，HEAD = `ea9c264`）

| commit | 内容 |
|---|---|
| `b919e06` | feat(detect): 三个 Lambda 采集器外壳 + 13 条测试 + template.yaml 扩成 4 采集器一栈 |
| `2fb3324` | chore(detect): 沿用现有栈名 `stayright-dev-weather-collector` |
| `769a667` | fix(detect): flight 采集器遇 provider 401/403 跳过 |
| `c361234` | chore(detect): volcano/flight/road 降到 `rate(1 day)`（`NewCollectorScheduleExpression` 参数） |
| `91d77f6` | chore: 新增 `scripts/deploy-backend.sh` + `scripts/deploy-frontend.sh` |
| `ea9c264` | fix(scripts): 后端部署写 gitignored 的 `backend/publish/` + guard journalctl grep |

#### 环境现状（2026-09-03 核查）

- EC2 `i-0d71260ab44ceb0c3` **running**，Elastic IP 32.237.54.103，SSM Online，
  Amazon Linux；`stayright-api.service` active、监听 `0.0.0.0:5080`。
- CloudFront `E3CNDKHDSY3D1I` **Deployed**，d2y6g16anevc6h.cloudfront.net。
- SAM 栈 `stayright-dev-weather-collector`：4 个采集器函数 + 4 条调度 + `CollectorPolicy`
  托管策略 + `CollectorScheduleRole` 共享调度角色。
- S3：`stayright-dev-raw-990393187001`（部署产物 `deploy/` + SAM `sam/`）、
  `stayright-dev-site-990393187001`（前端静态站）。
- Secrets Manager `stayright/dev/oag/api-key`：**2026-09-03 已写入有效的 AeroDataBox
  `X-RapidAPI-Key`**（版本 `6c8eb3ae-…`）。flight 采集器实测跑通（见下）。
- 演示库 disruptions 里 weather `Storm near Wellington` 重复几百条（#31，实测 763 条
  active），新增 1 条 road `SH94 closed — Milford Sound`（`54fa898b`，Zachary 决定保留）。
  演示前照旧用 `scripts/clean-demo-state.sh` 清场（注意脚本漏清 `Storm near Christchurch`
  / `Flood near Queenstown`，见排查简报）。

#### 2026-09-03（补）：航班源定为 AeroDataBox + 写入 key + 实测

- **决策**：航班源正式采用 **AeroDataBox**（via RapidAPI），不切 OAG。
- Zachary 提供有效 RapidAPI key → 经临时文件写入 Secret `stayright/dev/oag/api-key`
  （`put-secret-value`，不经命令行/日志），新版本 `AWSCURRENT`。
- **实测**：
  - `aws lambda invoke` FlightCollector → `{"ingested": 0}`（不再 `skipped`）；
    CloudWatch `flight_collector.done`，运行 15.5s（串行打 6 个机场的真实请求）。
  - 直接拿 key 打 AeroDataBox `/flights/airports/iata/AKL/...` → HTTP 200 + 真实航班数据。
  - `ingested: 0` 属正常：当前 6 个 NZ 机场都没到"大面积取消"阈值。
- **遗留**（不影响功能，按排查简报排期）：
  - Secret 名 `oag/api-key` 是误称，建议改 `flight/rapidapi-key`（同步改代码
    `secret("...")` 与 `AWS_SDK_SPEC.md` §4.3）。
  - `flight_status.py` 字段映射仍未对 AeroDataBox 真实响应做校验。
  - 免费额度：`rate(1 day)` × 6 机场 ≈ 180 次/月够用；勿恢复到 15 分钟（~576 次/天，超）。

#### 2026-09-03 排查:检测管线问题简报（A 去重 / B 数据源不一致）

排查三个新采集器时连带发现,已单独成简报发后端团队,要点:

- **A — 扰动重复入库（issue #31）**：weather 采集器每 15 分钟轮询 Open-Meteo,
  `IngestAsync` 零去重 → 763 条 active（670 条 `Storm near Wellington` 是同几场风）。
  `dedup.py` 是文件存状态,Lambda 用不了。建议:后端 `IngestAsync` 加去重（按
  `Type+Region+EventSubtype` 相同且时间窗重叠,只跟 active 比,severity 未升级则更新旧行
  不新建）;`Disruption` 表 `Severity`/`EventSubtype` 两列已存在待填;采集器 payload 补这两个值。
- **B — 数据源与文档/验证截图不一致**：
  - 火山 GeoNet ✅ 一致
  - 天气:代码 Open-Meteo,文档 `SIGNAL_ENDPOINT_METSERVICE`（MetService CAP,零代码）
  - 航班:代码 AeroDataBox,文档 OAG（已决策维持 AeroDataBox,见上节）
  - 道路:代码 TREIS `events/all/1` 解析 JSON;验证截图是 XML;SSM `SIGNAL_ENDPOINT_NZTA`
    是 `events/all/10`（zoom 1 vs 10、JSON vs XML 均不一致）
  - 通用:采集器硬编码端点 URL,没读 SSM `SIGNAL_ENDPOINT_*`（违背 CLAUDE.md AWS 铁律 1）
- 待团队拍板:天气用 Open-Meteo 还是 MetService CAP;道路 JSON/XML + zoom level。

### 更新记录

| 日期 | 变更 |
|---|---|
| 2026-09-03 | 三轨全量部署完成：A 采集器 SAM 上线（含 flight 401/403 跳过修复、新采集器降频 rate(1 day)）+ C 前端上线 + B 后端上线（迁移 AddCaseWorkflowStateHistory 自动应用，transfer 路由已验证）；部署流程固化为 `scripts/deploy-backend.sh` / `scripts/deploy-frontend.sh` |
| 2026-09-03（补） | 航班源定为 AeroDataBox；有效 RapidAPI key 写入 Secret `stayright/dev/oag/api-key`；flight 采集器实测跑通（`{"ingested": 0}`，无 skip）；记录检测管线排查简报（A 扰动去重 #31 / B 数据源与文档不一致） |

---

## 附：给 AI 的一句话总结

> 本项目所有 AWS 调用都通过 `adapters/aws.py` 的 `client()` 获取客户端；所有资源名通过 `cfg("KEY")` 从 SSM 读取，**绝不硬编码**；所有密钥通过 `secret("name")` 从 Secrets Manager 读取；区域固定 `ap-southeast-2`；Bedrock 模型 ID 必须是 SSM 里的**推理配置文件 ID**（`au.` 前缀，绝不用 `global.`）；`src/core/` 是纯函数层，禁止出现 boto3 / os.environ / datetime.now()；失败必须抛出异常不许吞；SQS 消费成功才删消息；Bedrock 用 `converse` + `toolConfig` 拿结构化输出；SES 用 v2 且处于沙箱模式（收件人须预先验证）；Postgres 用 `app` 用户 + 命名参数，不用 ORM；日常开发一律 `STAYRIGHT_LOCAL=1` 走本地假实现，不依赖 AWS 在线。
