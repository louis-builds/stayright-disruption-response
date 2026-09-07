# 生产环境 AWS 方案：EC2 全量 Lambda 化 + 托管数据库迁移提案

> 日期：2026-09-07 ｜ 作者：Zachary（Dev-Zachary）
> 状态：提案（待团队评审）
> 背景：延续 `AWS-Deployment-History.md` 2026-08-27 部署计划与 2026-09-03 三轨全量部署，规划从 dev（EC2 + Docker PG）升级为生产形态。

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
4. **环境策略**——是否沿用单环境（现 dev 直接升 prod），还是借机分 `dev`/`prod` 两套（SAM 栈 Stage 参数已支持，成本 +RDS 一份）。

---

## 8. 参考

- `AWS-Deployment-History.md`（2026-08-24 ~ 09-03 各节：现状盘点、SES 踩坑、部署管线）
- `docs/AWS_SDK_SPEC.md` §5.10（数据库规范现状：EC2 Docker 形态）
- Issue #31（扰动去重缺口——与本次迁移无依赖，独立排期）
