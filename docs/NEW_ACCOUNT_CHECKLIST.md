# 新账户（课程 demo 账户）上线前检查清单

> 2026-09-15 新增。配套 `CLAUDE.md`「新账户（课程 demo 账户）约束」一节和
> `docs/proposals/AWS_PROD_ENV_LAMBDA_MIGRATION.md` §7 决策点 4 的更新。
> 用途：在课程分配的新 AWS 账户（`ictgs-team1`，$200 额度）里实际创建资源前，
> 对照本清单逐项执行，避免遗漏账户级约束或误伤账户内预置资源。
>
> 本清单只列步骤，不重复写法——具体 SSM key / boto3 写法看 `docs/AWS_SDK_SPEC.md`，
> 数据库连法看 `docs/DATABASE_ACCESS.md`，架构设计看
> `docs/proposals/AWS_PROD_ENV_LAMBDA_MIGRATION.md`。

## 账户准备

- [ ] 用 `ICTGSStudentPermisionSet` 登录 <https://uoa-sso.awsapps.com/start/#/>，控制台右上角确认区域已切到 **Sydney (ap-southeast-2)**
- [ ] `aws cloudformation list-stacks --region ap-southeast-2` + 控制台核查账户内现有栈/Lambda，记录任何名字包含 `AWSAccelerator`、`ControlTower`、`CloudHealth` 的资源——列成一份"禁止触碰清单"存到 `infra/连接信息.md`（本地 gitignore 文件），后续所有自动化脚本都要避开这些资源
- [ ] 用 [AWS Price Calculator](https://calculator.aws) 对 `AWS_PROD_ENV_LAMBDA_MIGRATION.md` §6 的月成本估算做一次独立校验，确认在 $200 额度内有余量
- [ ] 在 Billing 里设置 AWS Budgets 告警（建议 $50 / $100 / $150 三档邮件告警）

## 基建搭建（对应 `AWS_PROD_ENV_LAMBDA_MIGRATION.md` §5 六步迁移路径）

- [ ] 在新账户里重新建齐 12 个 `/stayright/prod/{KEY}` SSM 参数（清单见 `docs/AWS_SDK_SPEC.md` §4.2），**不要**复用 dev 账户的具体值（bucket 名、队列名等新账户里都是全新的）
- [ ] 重新建 Secrets Manager 条目：`stayright/prod/db/password`、`stayright/prod/token/hmac-key`、`stayright/prod/oag/api-key`（+ `ingest/shared-key`，见 `AWS_SDK_SPEC.md` §13.2）
- [ ] 建 VPC（2 私有子网）+ RDS PostgreSQL `db.t4g.micro` + `CREATE EXTENSION vector; CREATE EXTENSION postgis;`（选型依据见 proposal §2，不要用 Aurora/更大规格，除非另有拍板）
- [ ] EC2 Docker PG `pg_dump` → S3 中转 → RDS 导入（proposal §2.4/§5②；注意 psql 客户端版本对齐）
- [ ] C# API 打 Lambda（容器镜像 + SnapStart）或维持 EC2 部署（视课程时间预算而定，非本清单强制项）
- [ ] 4 个采集器 Lambda（weather/volcano/flight/road）用 `detect/template.yaml` 独立 `sam deploy` 到新账户——**不要**共享 dev 账户的部署
- [ ] CloudFront + S3 前端复用现有部署模式（`scripts/deploy-frontend.sh`），但要传入新账户自己的 `SITE_BUCKET`/`CF_DIST_ID`

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
