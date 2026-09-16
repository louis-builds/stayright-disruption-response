# 新账户（课程 demo 账户）上线前检查清单

> 2026-09-15 新增。配套 `CLAUDE.md`「新账户（课程 demo 账户）约束」一节和
> `docs/proposals/AWS_PROD_ENV_LAMBDA_MIGRATION.md` §7 决策点 4 的更新。
> 用途：在课程分配的新 AWS 账户（`ictgs-team5`，账户 ID 025066268612，$200 额度）里实际创建资源前，
> 对照本清单逐项执行，避免遗漏账户级约束或误伤账户内预置资源。
>
> 本清单只列步骤，不重复写法——具体 SSM key / boto3 写法看 `docs/AWS_SDK_SPEC.md`，
> 数据库连法看 `docs/DATABASE_ACCESS.md`，架构设计看
> `docs/proposals/AWS_PROD_ENV_LAMBDA_MIGRATION.md`。

## 账户准备

- [x] 用 `ICTGSStudentPermissionSet` 登录 SSO 起始 URL（`https://identitycenter.amazonaws.com/ssoins-82596a7dc8914808`，SSO 区域 `ap-southeast-2`），控制台右上角确认区域已切到 **Sydney (ap-southeast-2)**（2026-09-15 完成，CLI profile `ictgs-team5` 已配置为 SSO 自动刷新）
- [x] `aws cloudformation list-stacks --region ap-southeast-2` + 控制台核查账户内现有栈/Lambda，记录任何名字包含 `AWSAccelerator`、`ControlTower`、`CloudHealth` 的资源——列成一份"禁止触碰清单"存到 `infra/连接信息.md`（本地 gitignore 文件），后续所有自动化脚本都要避开这些资源（2026-09-15 完成，另发现 `TenableOrgOnboardStackset`/`AzureDefenderforCloud` 两类此前未记录的资源，已一并列入）
- [ ] 用 [AWS Price Calculator](https://calculator.aws) 对 `AWS_PROD_ENV_LAMBDA_MIGRATION.md` §6 的月成本估算做一次独立校验，确认在 $200 额度内有余量
- [x] 在 Billing 里设置 AWS Budgets 告警（建议 $50 / $100 / $150 三档邮件告警）（2026-09-15 完成，`stayright-team5-monthly-200usd`，告警邮箱 `szha564@aucklanduni.ac.nz`；⚠️ 建好后发现账户在未建任何 stayright 资源前已有 $15.28 当月实际花费/$31.4 预测花费，来自账户预置的安全基线服务，会挤占可用预算）

## 基建搭建（对应 `AWS_PROD_ENV_LAMBDA_MIGRATION.md` §5 六步迁移路径）

- [ ] 在新账户里重新建齐 12 个 `/stayright/prod/{KEY}` SSM 参数（清单见 `docs/AWS_SDK_SPEC.md` §4.2），**不要**复用 dev 账户的具体值（bucket 名、队列名等新账户里都是全新的）
- [x] 重新建 Secrets Manager 条目：`stayright/prod/db/password`（2026-09-16 已建并轮换过一次，见下方⚠️）。`stayright/prod/token/hmac-key`、`stayright/prod/oag/api-key`（+ `ingest/shared-key`）**未建**
- [x] 建 VPC（2 私有子网 + 1 公有子网）+ RDS PostgreSQL `db.t4g.micro` + `CREATE EXTENSION vector; CREATE EXTENSION postgis;`（2026-09-16 完成，资源 ID 见 `docs/AWS_SDK_SPEC.md` §8.1）
- [ ] EC2 Docker PG `pg_dump` → S3 中转 → RDS 导入（proposal §2.4/§5②；注意 psql 客户端版本对齐）——**未做**，新 RDS 目前是空库（仅装了 vector/postgis 扩展）
- [x] EC2 跳板机已建（`i-06c845e0f6440716b` + EIP `3.105.155.148`，SSH key 认证，见 `AWS_SDK_SPEC.md` §8.1）。⚠️ **永久无法挂 IAM role**（`ICTGSStudentPermissionSet` 的 IAM 权限边界已向 Zachary 确认为课程侧定死、无法申请修改，非临时受限）；C# 部署到这台机器时怎么读 Secrets Manager/SSM 待 Zachary 拍板（候选方案见 `AWS_SDK_SPEC.md` §8.1"待办"）
- [ ] 4 个采集器 Lambda（weather/volcano/flight/road）用 `detect/template.yaml` 独立 `sam deploy` 到新账户——**不要**共享 dev 账户的部署
- [ ] CloudFront + S3 前端复用现有部署模式（`scripts/deploy-frontend.sh`），但要传入新账户自己的 `SITE_BUCKET`/`CF_DIST_ID`
- [x] ~~建开发团队 prod DB 隧道权限：4 个原生 IAM User~~ **已放弃**——`ICTGSStudentPermissionSet` 无 IAM 写权限，建不了 IAM User 也建不了 EC2 instance role，SSM 隧道方案整体作废。改为 Zachary 一人持有 EC2 SSH key 手动管理数据库，见 `AWS_SDK_SPEC.md` §8.1
- [ ] （待定，非本清单强制）团队本地开发若要统一连 prod 库，需要另写 SSH 版隧道脚本 + 项目连接串模板，且需先确认私钥怎么安全分发给其他 3 位成员

## 脚本联调（改造后的脚本不再有 dev 账户默认值，必须显式传参）

- [ ] `EC2_INSTANCE_ID=<新账户实例ID> RAW_BUCKET=<新账户bucket> scripts/deploy-backend.sh`
- [ ] `SITE_BUCKET=<新账户bucket> CF_DIST_ID=<新账户CF ID> scripts/deploy-frontend.sh`
- [ ] `EC2_INSTANCE_ID=<新账户实例ID> scripts/db-tunnel.sh`（本地联调用；`db-tunnel-install.sh` 同理）
- [ ] `BASE=<新账户CloudFront域名> scripts/seed-hotels.sh` / `clean-demo-state.sh` / `seed-demo-full.sh` / `seed-demo-second-case.sh`
- [ ] 如需重新走 CI/CD bootstrap：`ACCOUNT_ID=<新账户ID> RAW_BUCKET=... SITE_BUCKET=... CF_DIST_ID=... EC2_INSTANCE_ID=... infra/bootstrap-cicd.sh`

## 移动端协同

- [ ] 新账户的 API 入口地址（API Gateway/Function URL 或 CloudFront `/api/*`）确定后，同步给移动端团队写入 App 配置；明确该地址后续变更需要提前协调（原生 App 换后端地址成本高于网页端热更新）
- [ ] （跨团队依赖，非本清单负责范围）移动端团队需要自行解决 Cookie-based 认证在原生 App 场景下的可用性问题——记录为已知阻塞项，不在本次 AWS 账户搭建里处理

## 收尾

- [ ] 确认没有把任何新账户的 account ID / instance ID / 长期密钥提交进 Git（`git status`/`git diff` 检查一遍）
- [ ] 更新 `CLAUDE.md` 技术栈表和 `docs/AWS_SDK_SPEC.md` §13.2 部署时间线，补记新账户的实际部署过程（沿用现有"现状要同步更新，别让文档漂移"的维护约定）
