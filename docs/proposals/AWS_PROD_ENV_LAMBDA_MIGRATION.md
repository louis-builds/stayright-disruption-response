# 生产环境 AWS 方案：EC2 全量 Lambda 化 + 托管数据库迁移提案

> 日期：2026-09-07 ｜ 作者：Zachary（Dev-Zachary）
> 状态：提案（待团队评审）
> 背景：延续 `docs/AWS_SDK_SPEC.md` §13.2（原 `AWS-Deployment-History.md`，2026-09-08 已合并进该节，原文件是本地 gitignore 文件从未进仓库）2026-08-27 部署计划与 2026-09-03 三轨全量部署，规划从 dev（EC2 + Docker PG）升级为生产形态。
>
> ⚠️ **2026-09-08 更新**：§7 决策点 4 已拍板为双环境，且 prod 建在**另一个独立 AWS 账户**（$200 额度），不是本文档原设想的同账户 SAM Stage 分环境。本文档下方涉及"同账户"的部分（成本估算、Secrets/SSM 复用、S3 中转迁移路径）需要按跨账户场景重新核对，详见 §7 第 4 点的更新说明。
>
> ⚠️ **2026-09-15 重大修订（Zachary 拍板）**：本文档 §3～§6 里"C# API 打成 Lambda"的方案**已否决**，改为更简化的方案——**C# 后端继续留在 EC2 上跑，只把数据库单独迁到 RDS**。原因、影响范围、新的成本核对见 §8（新增）。§3～§6 仍保留作为"曾经考虑过、为什么放弃"的记录，不要再作为当前落地依据。

---

## 0. TL;DR

- **数据库问题**：EC2 拆成 Lambda 后，Docker 容器里的 PostgreSQL 失去宿主机，**必须迁到 AWS 托管数据库**（RDS / Aurora），这不是选择题而是架构推导的必然结论。
- **推荐**：RDS PostgreSQL 16 `db.t4g.micro` 单实例起步（悉尼区），兼容 pgvector + PostGIS，C# 侧只改连接串 host。
- **总体方向**：前端 S3 + CloudFront 不变；C# API 拆为 Lambda（进 VPC）；4 个采集器 Lambda 现状保留（VPC 外）；数据库进私有子网。
- **成本**：净变化与现状基本持平甚至更低（EC2 退役抵消 RDS 新增）。

---

## 1. 现状（dev 环境，2026-09-03 核查）

| 组件 | 现状 | 生产形态的问题 |
|------|------|------|
| 后端 API | .NET 9 自包含部署在 EC2 systemd 服务（`stayright-api`，:5080） | 常驻进程模型，与 Lambda 事件模型冲突 |
| 数据库 | PostgreSQL 16.15 + PostGIS 3.4.3 + pgvector 0.8.6，**跑在 EC2 的 Docker 容器 `pg`**，仅监听 127.0.0.1 | EC2 退役后无处安放 |
| 前端 | S3 site 桶 + CloudFront（OAC 私有回源 + SPA Function 重写） | ✅ 无需改动 |
| 采集器 | 4 个 Lambda（weather/volcano/flight/road）+ EventBridge Scheduler，SAM 一栈 | ✅ 已是目标形态 |
| 后台任务 | `HandoffIngestJob`（15s 文件监听）、`FaqClusteringJob`（定时聚类） | Lambda 无法常驻/监听文件，需改造 |
| 迁移机制 | 服务启动时 `db.Database.MigrateAsync()` 自动应用 | Lambda 并发冷启动会互相踩，执行点需重新设计 |

---

## 2. 数据库决策：托管数据库选型

### 2.1 为什么是托管、且只有托管

Lambda 是无状态函数；全 Lambda 化意味着 EC2 退役，自建（Docker/系统级）PG 失去宿主。生产环境的数据库只剩托管一条路：**RDS for PostgreSQL** 或 **Aurora PostgreSQL**。

### 2.2 选型对比（悉尼区 ap-southeast-2，与现有资源同区）

| 维度 | **RDS PostgreSQL 单实例**（推荐起步） | **Aurora PostgreSQL Serverless v2** |
|------|------|------|
| 版本/扩展 | PG 16，✅ pgvector + ✅ PostGIS | PG 16，✅ pgvector + ✅ PostGIS |
| 规格 | `db.t4g.micro`（1C/1G） | 0.5 ACU 起（约 1C/2G） |
| 计费 | 固定按小时，闲忙同价 | 按 ACU 小时 + 存储分离，自动升降 |
| 月成本（⚠️ 估算） | ~$15 ≈ ¥101 | ~$22–25 ≈ ¥148–168 |
| 适合场景 | 流量平稳、成本敏感 | 流量波动大、架构展示 |

**推荐 RDS 起步的理由**：当前流量为课程演示级，Aurora 弹性优势用不上而账单高 50%；RDS → Aurora 迁移只是一次 pg_dump，无锁定风险。若课程评分看重架构 showcase，Aurora Serverless v2 的叙事更漂亮，多花的钱当学费也值——两者技术栈完全兼容，C# 零代码改动。

### 2.3 两个成本/配置上的明确取舍

1. **不上 RDS Proxy**（固定 ~¥75+/月）：低流量阶段用「Lambda 预留并发上限（如 20）+ EF 短连接」即可，流量上来再加。
2. **网络设计规避 NAT Gateway**（~¥275+/月）：Lambda 分两层，采集器留在 VPC 外（只需出公网 + 回调 API，不碰库），只有 API Lambda 进私有子网连 RDS。

### 2.4 迁移注意

- 建实例后先 `CREATE EXTENSION vector; CREATE EXTENSION postgis;` 再导数据（RDS 参数组确认共享内存预载配置）。
- 数据搬迁复用 8/27 的 S3 中转流程：EC2 `pg_dump` → S3 → RDS `psql` 导入；注意 psql 客户端版本对齐（`\restrict` 元命令教训见部署历史）。
- 连接凭证沿用 Secrets Manager `stayright/prod/db/password`，IAM 角色读取，不落代码。

---

## 3. 目标架构

```text
                         CloudFront (现有 E3CNDKHDSY3D1I，不变)
                        /            \
                  静态前端            /api/*
                  S3 site 桶         API Gateway HTTP API（或 Lambda Function URL）
                   (不变)                  |
                                    ┌───────┴────────┐
                              公网 Lambda层      VPC 内 Lambda 层
                              (不进 VPC，        (私有子网 ×2)
                               零 NAT 成本)        |
                              4 个采集器      C# API Lambda ×N
                              (现有 SAM 栈     (.NET 8 + SnapStart
                               原样保留，        或容器镜像)
                               POST → API)        |
                                            RDS / Aurora
                                          (私有子网，SG 只放行
                                           API Lambda 的安全组)
```

安全组规则收敛为一条：API Lambda 的 SG → RDS :5432；RDS 不可公网访问；采集器与现在一样经 `/api/ingest/disruptions` + `X-Ingest-Key` 写入。

---

## 4. 三个必须解决的改造坑（不是"搬"，是"改"）

| # | 冲突点 | 现状 | Lambda 化方案 |
|---|------|------|------|
| 1 | **EF Core 冷启动** | EC2 常驻进程无此问题 | .NET Lambda 冷启动 2–5s（EF 初始化是大头）。对策：**Lambda SnapStart（.NET 8 已支持）** 或容器镜像 + 预留并发 1–2 |
| 2 | **后台常驻任务** | `HandoffIngestJob` 15s 文件监听；`FaqClusteringJob` 定时聚类 | Handoff 链路下线（detect Lambda 已直连 ingest API）；FAQ 聚类改 **EventBridge Scheduler 定时触发独立 Lambda** |
| 3 | **迁移执行点消失** | 启动时 `MigrateAsync()` | 改为**独立 migration Lambda**（部署流程里 invoke 一次）或 `dotnet ef migrations bundle` 进部署管道 |

---

## 5. 迁移路径（六步）

```text
① 建 VPC(2 私有子网) + RDS + CREATE EXTENSION vector/postgis
② EC2 容器 PG pg_dump → S3 中转 → RDS 导入
③ C# 打 Lambda（容器镜像优先）+ SnapStart + 连接串指向 RDS
④ API Gateway/Function URL 上线 → CloudFront /api/* 回源切换
   （观察期双跑：旧 EC2 API 保留回滚点）
⑤ 后台任务改造（FAQ→Scheduler Lambda；Handoff 链路下线）
⑥ 稳定观察 1–2 周后 EC2 停机退役，EIP 释放
```

---

## 6. 月成本估算（悉尼区，⚠️ 按官方定价粗算）

| 项目 | 变化 | 月成本（约） |
|------|------|------|
| RDS db.t4g.micro 单可用区 | 新增 | ¥101（Aurora 方案 ¥150–170） |
| EC2 t3.micro + EIP | 退役 | **−¥80～90** |
| API Lambda + SnapStart | 新增 | 低流量下大概率免费额度内（¥0–15） |
| NAT Gateway | **不买**（设计规避） | ¥0 |
| 采集器 Lambda/CloudFront/S3/SES/Secrets | 不变 | ¥10 以内 |
| **净变化** | | **与现状基本持平甚至更低** |

汇率按 1 USD ≈ 6.71 CNY（2026-09-07 收盘区间中值）换算，实际结算以账单为准。

---

## 7. 待团队拍板的决策点

1. **RDS 还是 Aurora Serverless v2**——成本 vs 展示效果（提案倾向：RDS 起步）。
2. **API 入口用 API Gateway 还是 Lambda Function URL**——后者免费够用；前者有 throttling/阶段管理，叙事更完整。
3. **切换节奏**——建议 EC2 双跑一周作回滚点（多烧约 ¥20）。
4. **环境策略** ✅ 已决策（2026-09-08，Zachary）：采取双环境（dev/prod）。

   **⚠️ 与本提案原方案不同：不是同账户 SAM Stage 参数分环境，而是 prod 建在另一个独立 AWS 账户上**（该账户有 $200 额度）。这个决定改变了本文档几处默认假设，后续落地/评审时要注意：

   - §2.4「迁移注意」里"连接凭证沿用 Secrets Manager `stayright/prod/db/password`"——跨账户后 prod 账户要有自己独立的 Secrets Manager 条目和 SSM 参数集（`/stayright/prod/{KEY}` 那 12 个 key 要在新账户里重新建一遍），不是同账户下加个 stage 前缀那么简单。这恰好是 `docs/AWS_SDK_SPEC.md` 里"资源全走 `cfg()`/`secret()`"设计所承诺的"换账户零改动"红利第一次被真正用上——业务代码不用改，但**基建侧要在新账户里重新走一遍 SSM/Secrets 建立流程**。
   - §5「迁移路径」的 pg_dump → S3 → 导入流程原设计是同账户中转，跨账户需要额外确认：是走跨账户 S3 bucket policy 授权，还是本地下载再上传到新账户的桶——待与团队确认。
   - §3 目标架构图、§6 成本估算目前都是单账户视角（CloudFront/EC2/RDS 算在一套账单里），需要在新账户建立后重新核算 prod 侧独立成本；dev 账户现有资源保留还是退役，待定（大概率保留作为开发环境）。
   - 待补充信息：新账户何时到位、由谁开通、detect/ 的 4 个采集器 Lambda 是否也要在新账户里独立部署一份（目前是单一部署面向单一环境）。

   > ⚠️ **2026-09-15 更新（回填上面的待补充信息）**：新账户已到位——课程分配的账户（`ictgs-team5`，账户 ID 025066268612，$200 额度），Zachary 是唯一 cloud owner。明确本账户定位为**课程 demo/评分用途**，不是长期商业化 prod——这解释了为什么本文档"课程演示级流量"的判断（推荐 RDS `db.t4g.micro` 而非 Aurora）依然成立，不需要因为"新账户=更正式的 prod"而重新评估架构选型。4 个采集器 Lambda 需要在新账户里独立重新部署一份（`sam deploy` 到新账户，而不是共享 dev 账户的部署）。
   >
   > 另外新账户带来一条本文档未覆盖的约束：账户内有教学团队预置的 `AWSAccelerator`/`ControlTower`/`CloudHealth` 相关 Lambda/CloudFormation 栈，**绝对不能碰**。执行 §5 迁移步骤①（建 VPC/RDS）及任何 IaC/清理脚本前，先 `aws cloudformation list-stacks` + 控制台核查一遍账户内现有栈，确认不会被自动化操作波及。详见 `CLAUDE.md`「新账户（课程 demo 账户）约束」一节和 `docs/NEW_ACCOUNT_CHECKLIST.md`。

---

## 8. 2026-09-15 修订：C# 后端不上 Lambda，只把数据库迁到 RDS

### 8.1 为什么否决"C# 打 Lambda"

StayRight 的 15 分钟"扰动发生后首次触达客人"是硬指标，且这个时间预算是**检测 → 匹配 → 政策解算 → 通知**端到端共享的——政策解算（判定某笔预订在其房型的改签/取消政策下能做什么）和触发通知，目前就发生在 C# 后端的案件处理链路里，不是只有 Python 侧的 `detect/` 在这个时钟上。

文献依据（课程调研引用）：
- Golec et al. 对 serverless 冷启动延迟的综述指出，冷启动对延迟敏感型服务是持续存在、没有完全解法的问题——启动时间不可预测的平台撑不住硬性截止时间。
- 扰动到达是突发的（一场风暴几分钟内影响上百个预订）。Cardellini et al. 指出面对负载突变的流处理系统需要显式的运行时自适应；Liu & Buyya 的结论是延迟关键型应用的调度必须由 SLA 驱动，而不是吞吐量驱动。Lambda 的扩容模型恰恰是吞吐量驱动的自动伸缩，不是 SLA 延迟保证的调度——突发并发意味着一批冷启动集中出现在时钟最紧的时候。

结论：**案件处理/政策解算/触发通知这条链路不应该跟着"退役 EC2"一起打包上 Lambda**，应该留在常驻进程上。与其去拆分 C# 里"哪些接口在时钟上、哪些不在"（认证、酒店资料管理、FAQ/RAG 聊天这些不在时钟上，可以上 Lambda），更简单、风险更低的做法是**整个 C# 后端都不动**，只解决最初驱动这次迁移提案的那个具体问题——EC2 退役后 Docker Postgres 没地方放——**只把数据库单独迁出来**。

### 8.2 修订后的目标架构

```text
                         CloudFront（不变）
                        /            \
                  静态前端            /api/*
                  S3 site 桶         EC2（C# API，systemd 常驻服务，不变）
                   (不变)                  |
                                          RDS PostgreSQL
                                    （替代 EC2 上的 Docker pg 容器；
                                     EC2 与 RDS 同 VPC 或走安全组放行，
                                     不需要 §3 原方案里的两层 Lambda VPC 设计）

              4 个采集器 Lambda（现有 SAM 栈，原样保留，POST → API）
```

对比原方案（§3）：**取消** API Gateway/Lambda Function URL 入口、C# 容器镜像 Lambda、两层 VPC 设计（公网 Lambda 层 + VPC 内 Lambda 层）、NAT 规避设计——这些复杂度都是"C# 上 Lambda"才需要解决的问题，C# 不动就不需要解决。

### 8.3 §4"三个改造坑"不再适用

原文档 §4 列的三个坑（EF Core 冷启动、后台常驻任务 `HandoffIngestJob`/`FaqClusteringJob`、迁移执行点消失）**全部是"C# 打 Lambda"才会引入的问题**——C# 继续常驻 EC2，这三个坑都不存在，不需要改造 `MigrateAsync()` 的执行时机，也不需要把 FAQ 聚类拆成独立 Scheduler Lambda。

### 8.4 修订后的迁移路径（四步，原六步简化）

```text
① 新账户里建 RDS PostgreSQL db.t4g.micro + CREATE EXTENSION vector/postgis
② EC2 容器 PG pg_dump → S3 中转 → RDS 导入（沿用原 §5②，不变）
③ C# 连接串（appsettings / 环境变量）指向 RDS endpoint，其余代码不动；
   本地 `dotnet publish` + `scripts/deploy-backend.sh` 部署流程不变
④ 观察稳定后，EC2 上的 Docker Postgres 容器停用（`docker compose down` /
   移除该容器），EC2 本身继续跑 C# API
```

不需要原 §5 的③④⑤（C# 打包 Lambda、API Gateway 切流、后台任务改造）和⑥（EC2 停机退役——EC2 现在不退役，继续用来跑 C#）。

### 8.5 成本核对（用 AWS Price Calculator 重新核对，2026-09-15，Sydney 区）

公开估算链接：<https://calculator.aws/#/estimate?id=640e5cadc60baf904c1ef137f053f8b000fcd860>（1 年后失效）

| 项目 | 月成本 |
|---|---|
| RDS `db.t4g.micro` 单可用区 + 20GB gp3 | $21.01 |
| EC2 `t3.micro`（On-Demand，Linux，常驻）+ 20GB gp3 EBS | $11.56 |
| 4 个采集器 Lambda | $0.00（免费额度内） |
| S3（site + raw） | $0.14 |
| CloudFront | $0.00（1TB/月数据传出永久免费） |
| Secrets Manager（4 个密钥） | $1.60 |
| SES | $0.05 |
| CloudWatch | $2.17 |
| Bedrock fallback（保守估算上限） | $5.54 |
| **月度合计** | **$42.07**（12 个月 $504.84） |

比原方案（§6 估算"净变化与现状基本持平"）多了 EC2 这一项固定成本（约 $11.56/月），因为 EC2 不退役了。在新账户 $200 额度下，按 $42.07/月计算可支撑约 **4.75 个月**——仍在预算内，但余量比"全量 Lambda 化"方案更紧，需要配合 `CLAUDE.md`「新账户约束」里的 AWS Budgets 三档告警使用。

### 8.6 结论

本次修订不是否定"未来某天可能需要把 C# 案件处理这部分也做成延迟可控的 serverless 形态"——如果以后要做，正确做法是按 §8.1 的 SLA 边界精确拆分（时钟上的部分保持常驻，时钟外的部分可以上 Lambda），而不是整体打包。但对课程账户这个阶段的目标（在 $200 预算内低风险跑起来），**最简方案就是最优方案**：C# 不动，只解决"数据库需要托管化"这一个真问题。

---

## 9. 参考

- `docs/AWS_SDK_SPEC.md` §13.2（原 `AWS-Deployment-History.md`，2026-09-08 已合并：2026-08-24 ~ 09-03 各节，现状盘点、SES 踩坑、部署管线）
- `docs/AWS_SDK_SPEC.md` §5.10（数据库规范现状：EC2 Docker 形态）
- Issue #31（扰动去重缺口——与本次迁移无依赖，独立排期）
