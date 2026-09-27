# 系统结构图 & 关键时序图

**最后核实**：2026-09-24（三个手机 App 连 CloudFront 已在 Android 模拟器上实测走通，不是只改了配置没验证）

这份文档描述的是**部署在 AWS 上的生产环境**，不含本地开发流程——本地怎么连库、怎么起服务见 `docs/DATABASE_ACCESS.md` / `docs/TEAM_DB_ACCESS.md` / `docs/DEV_DB_SETUP.md`，这里不重复。

这份文档回答两个问题：

1. **结构图**——Web 前端、三个手机 App、后端、数据库、外部服务在生产环境里实际连的是谁、走的是哪条路。
2. **时序图**——一条扰动从被采集到案件解决，具体按什么顺序经过哪些接口（对应 `CLAUDE.md`"必须遵循的模式"里"采集 → 变化检测 → 匹配 → 闸门 → 裁决 → 触达 → 回调 → 重订"那条描述，这里画成了实际验证过的接口调用顺序）。

两张图都用 Mermaid 写，GitHub 打开本文件会直接渲染，不需要额外工具；改代码/改部署方式之后，**图跟着改，不要让它变成第二份漂移的文档**。

---

## 1. 系统结构图

```mermaid
flowchart TB
    subgraph Clients["客户端"]
        Web["Web 前端<br/>React · frontend/"]
        Guest["Guest App<br/>Expo · nz.stayright.guest"]
        Hotel["Hotel App<br/>Expo · com.stayright.hotelapp"]
        Coord["Coordinator App<br/>Expo · nz.stayright.coordinator"]
    end

    CF["CloudFront<br/>d1s582gz77wdm.cloudfront.net"]
    S3Static["S3 静态资源<br/>OAC，桶不公开"]

    subgraph EC2["EC2 · stayright-prod-bastion"]
        Backend["C# 后端<br/>systemd stayright-api :5080"]
        Detect["detect/ 采集器 ×4<br/>cron 定时任务"]
        Handoff["handoff.jsonl"]
    end

    RDS[("RDS · stayright-prod-db<br/>Postgres + pgvector + PostGIS")]

    Gemini["Gemini API<br/>主 LLM"]
    Bedrock["AWS Bedrock<br/>fallback：zai.glm-5 可用<br/>anthropic/nova 被组织 SCP 拦截"]
    SMTP["SMTP<br/>MailKit 邮件通知"]
    S3Policy["S3 policy-docs<br/>酒店政策 PDF"]

    Web -->|HTTPS 公网| CF
    Guest -->|"HTTPS，eas.json production profile"| CF
    Hotel -->|"HTTPS，eas.json production profile"| CF
    Coord -->|"HTTPS，eas.json production profile"| CF

    CF -->|默认行为| S3Static
    CF -->|"/api/* 转发"| Backend

    Backend -->|同 VPC 直连 Npgsql| RDS
    Detect -.->|读 bookings/hotels 做匹配| RDS
    Detect -->|写入| Handoff
    Handoff -->|HandoffIngestJob 监听摄入| Backend

    Backend --> Gemini
    Backend --> Bedrock
    Backend --> SMTP
    Backend --> S3Policy

    classDef prod fill:#DCE7F0,stroke:#2C5F8A,color:#1C2333;
    classDef client fill:#F3E2CC,stroke:#B5651D,color:#1C2333;
    classDef neutral fill:#EDEAE2,stroke:#8a8a8a,color:#1C2333;
    class CF,S3Static,Backend,RDS,Detect,Handoff prod;
    class Web,Guest,Hotel,Coord client;
    class Gemini,Bedrock,SMTP,S3Policy neutral;
```

**图例**：蓝色系 = EC2/RDS 组成的生产核心链路；橙色系 = 四个客户端（Web + 三个手机 App），全部经 CloudFront 打进来；灰色 = 后端对外调用的外部服务。实线箭头都是已验证可用的连接；虚线（`detect → RDS` 那条）是只读查询，跟其他写入路径区分开。

### 几个容易搞混的点

- **四个客户端走的是同一个入口**：Web 前端和三个手机 App（生产构建，`eas.json` 的 `production` profile）都连 `https://d1s582gz77wdm.cloudfront.net`，CloudFront 按路径分流——静态资源走 S3，`/api/*` 转发到 EC2 后端。三个手机 App 这条路径已在 2026-09-24 于 Android 模拟器实测：登录、Cookie/Session 跨域认证、真实 prod 数据读取全部验证通过。
- **EC2 后端连库直连，不经任何中间层**：后端和 RDS 在同一个 VPC，走 Npgsql 直连 5432 端口。
- **detect 采集器没有对外接口**：是 EC2 上的 cron 任务，不能被手机/前端直接调用，只能通过它写入 `handoff.jsonl` → 后端摄入 → 案件/通知这条链路间接产生影响。
- **EC2 安全组只放行 CloudFront**：后端 5080 端口的入站规则只认 CloudFront 官方 IP 段（托管前缀列表），不对公网裸开——所有客户端流量必须经过 CloudFront 这一层，没有绕开的路径。

---

## 2. 关键时序图：一条扰动从检测到案件解决

覆盖种子数据里全是 closed case、平时测不到的这条主链路（本序列已在 2026-09-23 用 `scripts/seed-open-case.sh` 实测走通过一遍，不是凭接口猜的）。

```mermaid
sequenceDiagram
    participant D as detect/ 采集器
    participant DB as RDS
    participant BE as C# 后端
    participant C as Coordinator
    participant G as Guest
    participant H as Hotel

    D->>DB: 读 bookings/hotels 匹配受影响预订
    D->>BE: 写 handoff.jsonl
    BE->>BE: HandoffIngestJob 监听并摄入
    BE->>DB: upsert Disruption

    C->>BE: POST /disruptions/{id}/candidates/notify
    BE->>DB: 建 Case(pending) + 系统开场白消息 + 指派协调员
    BE->>DB: 建 Inquiry(deferral, pending) 给酒店
    BE-->>G: 通知：您的预订可能受影响

    BE-->>C: AI 自动生成 2-3 个方案（Defer / Move / Cancel&refund）
    C->>BE: POST push options to guest
    BE-->>G: 通知：新方案已就绪

    G->>BE: 选一个方案（Compare → Confirm）

    alt 方案需要酒店确认（Defer / Move to alternative）
        BE-->>H: 通知：该预订有一条待确认请求
        H->>BE: POST confirm deferral
        BE-->>G: 通知：酒店已确认
    else 方案无需酒店确认（Cancel & refund）
        BE-->>C: 通知：客人选择取消，待确认退款
        C->>BE: Escalation Desk：Step1 确认退款金额 → Step2 关单
        BE-->>G: 通知：案件已解决
        BE-->>H: 通知：案件已解决
    end
```

**备注**：`alt` 分支对应的是两类方案的不同收尾路径——需要酒店确认的（Defer/Move）走酒店端 `/hotel/inquiries/{id}/confirm`；不需要酒店确认的（Cancel & refund）直接进协调员的 Escalation Desk 走最终决议。两条分支都已用真实 open case 走通过，不是理论推测。

---

## 维护约定

- 这两张图描述的是**生产环境的当前实现状态**，不是设计目标——架构变了（比如换了认证方式、加了新的外部服务），**先改代码再改图**，图跟着代码走，不要反过来。
- 改动较大时更新顶部"最后核实"日期。
- 本文档只画生产环境的"连接关系"和"调用顺序"，不含本地开发流程——本地怎么连库、密钥怎么给见 `docs/DATABASE_ACCESS.md` / `docs/TEAM_DB_ACCESS.md` / `docs/DEV_DB_SETUP.md`；AWS 资源清单/写法见 `docs/AWS_SDK_SPEC.md`。不在这里重复那几份文档的内容。
