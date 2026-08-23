# Kakapo — StayRight NZ Disruption Agent (MVP: Detect + Identify)

## 项目现状

这是一个从零开始的仓库。**当前阶段只做两件事**：

1. **异常事件监测（Detect）**：从外部数据源（先做天气，接口设计上要支持以后加航班/路况）拉取数据，归一化成统一的 `DisruptionEvent`。
2. **受影响客户识别（Identify）**：根据 `DisruptionEvent` 的地理范围和时间范围，从订单库里查出受影响的客户。

**不要做的事（明确排除，避免自己发挥跑偏）**：
- 不实现 agent 推理 / 方案生成（RAG、MCP、LangGraph、Bedrock）——这是下一阶段，不在这个仓库当前范围内。
- 不使用 Google ADK 或任何旧项目里的 agent 框架。
- 不实现通知发送（SES/SNS）、方案执行（Step Functions saga）、人工介入队列——这些都是后续阶段。
- 如果某个任务看起来需要用到上面这些能力，先停下来问，而不是自己顺手加进去。

MVP 的验收标准：给一个模拟的天气异常事件，系统能自动跑出"哪些订单受影响"这一份列表，全程无需人工干预。

## 技术栈

- 语言：Python 3.12（Lambda handler 和本地脚本统一用 Python，避免语言混杂）
- 数据源：先接 Open-Meteo（免费、无需 API key，适合 MVP）
- 计算：AWS Lambda
- 调度/事件：AWS EventBridge（Scheduler 定时触发检测；未来其他事件源也走 EventBridge）
- 数据库：Aurora Serverless v2 (Postgres) 或本地开发用普通 RDS Postgres / 本地 Postgres 均可，正式部署前先在本地 Postgres 或 Docker 里跑通逻辑
- 连接池：Lambda 连 RDS 通过 RDS Proxy（本地开发阶段可以先直连，上云前再补 Proxy）
- 测试：pytest + 本地假数据（不依赖真实 AWS 资源也能跑单元测试）

## DisruptionEvent Schema（统一事件格式）

所有检测到的异常，不管来源是什么，都要归一化成这个结构，不要让每个数据源自己发挥格式：

```json
{
  "event_id": "uuid",
  "source": "weather | flight | road (目前只有 weather)",
  "event_type": "storm | flood | heavy_snow | ... (细分类型)",
  "severity": "low | medium | high",
  "detected_at": "ISO8601 UTC",
  "affects_window": {
    "start": "ISO8601 UTC",
    "end": "ISO8601 UTC"
  },
  "geo": {
    "type": "point | polygon",
    "center": { "lat": 0.0, "lng": 0.0 },
    "radius_km": 0
  },
  "raw_payload": { "...": "原始 API 返回，保留用于排查问题，不用于业务逻辑" }
}
```

新增数据源时，只允许在"抓取+归一化"这一层做适配，输出必须符合这个 schema，不要在下游（识别模块）里对不同来源做特殊判断。

## 数据库结构（受影响客户识别用）

至少需要这两张表（先在本地建，字段可以随开发调整，但改动要同步更新这里）：

- `properties`：房源/酒店信息，至少要有 `property_id`, `name`, `lat`, `lng`
- `bookings`：订单信息，至少要有 `booking_id`, `property_id`, `guest_id`, `check_in`, `check_out`

匹配逻辑：`DisruptionEvent.affects_window` 与 `booking.check_in ~ check_out` 有重叠，且 `property.lat/lng` 落在 `DisruptionEvent.geo` 的范围内（point+radius 用距离公式或 PostGIS `ST_DWithin`，先不追求精确大圆距离，能跑通即可）。

需要一份**种子数据**（几个虚构的 property + 十几条 booking），保证至少有 1-2 条能被某个测试天气事件命中，用于演示和测试。种子数据放在 `seed_data/`，用脚本生成或直接写死 SQL/CSV 均可。

## 代码约定

- SQL 一律用参数化查询，禁止字符串拼接
- 每条日志带上 `event_id`，方便追踪一次检测触发了哪些后续查询
- Lambda handler 统一签名：接收 event/context，返回结构化 JSON；本地也要能脱离 Lambda 运行时直接调用（方便测试，不要把逻辑锁死在 handler 里，业务逻辑单独抽函数）
- 每个模块（detect / identify）都要有对应的 pytest 用例，不依赖真实网络请求和真实数据库（用 mock / 本地测试库）

## 建议目录结构

```
Kakapo/
  src/
    detect/          # 天气API拉取 + 归一化成 DisruptionEvent
    identify/         # 受影响客户匹配逻辑
  seed_data/          # 测试用的 property/booking 数据
  tests/
    test_detect.py
    test_identify.py
  infra/              # 以后放 IaC（Terraform/CDK/SAM），MVP阶段可以先空着
  README.md
```

## 当前优先级

1. 先把 `DisruptionEvent` 的 pydantic/dataclass 模型定义好，写单元测试锁死这个 schema
2. 本地 Postgres（或 Docker）建表 + 种子数据
3. 检测模块：调 Open-Meteo，归一化输出，先不接 EventBridge（本地能跑通脚本即可）
4. 识别模块：SQL 匹配逻辑，先不接 RDS Proxy（本地直连）
5. 两个模块串起来跑一次端到端的本地测试
6. 最后再补 AWS 部署相关的东西（EventBridge、Lambda 打包、RDS Proxy）
