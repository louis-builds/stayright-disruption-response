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

- [x] 12 个 `/stayright/prod/{KEY}` SSM 参数已全部写入（2026-09-18）。其中 `RAW_BUCKET`/`SITE_BUCKET`/`EVENT_BUS`/`EVENTS_QUEUE_URL` 对应新建的真实资源（见下方两条）；`BEDROCK_MODEL_ID`/4 个 `SIGNAL_ENDPOINT_*` 是外部固定值，直接写入；`SES_SENDER`/`CALLBACKS_QUEUE_URL`/`FUNCTION_URL` 三个填了占位值但**均已确认废弃不再需要**——`SES_SENDER` 因邮件通知维持 SMTP 不走 SES；`CALLBACKS_QUEUE_URL`/`FUNCTION_URL` 因回调 Lambda 方案作废（C# 后端 `CaseActionsController` 已有等价实现，见 `docs/AWS_SDK_SPEC.md` §5.9），三者都不会被任何代码读取，不用处理
- [x] 新建 S3 ×2（`stayright-prod-raw-025066268612`、`stayright-prod-site-025066268612`，AES256 加密 + 阻止公开访问；raw 桶 90 天转 IA）、SQS ×3（`stayright-prod-events.fifo` 主队列 + `stayright-prod-events-dlq.fifo` 死信队列，redrive `maxReceiveCount=3` + `stayright-prod-callbacks` 标准回调队列）、EventBridge 自定义总线 `stayright-prod-bus`（2026-09-18）
- [x] 重新建 Secrets Manager 条目（5/5 全部建齐，2026-09-18）：`stayright/prod/db/password`（2026-09-16 已建并轮换过一次，见下方⚠️）、`stayright/prod/token/hmac-key`、`stayright/prod/ingest/shared-key`（随机生成）、`stayright/prod/oag/api-key`（Zachary 提供的 AeroDataBox/RapidAPI 真实密钥）、`stayright/prod/gemini/api-key`（Zachary 确认提供的真实 key）
- [x] 建 VPC（2 私有子网 + 1 公有子网）+ RDS PostgreSQL `db.t4g.micro` + `CREATE EXTENSION vector; CREATE EXTENSION postgis;`（2026-09-16 完成，资源 ID 见 `docs/AWS_SDK_SPEC.md` §8.1）
- [x] ~~EC2 Docker PG `pg_dump` → S3 中转 → RDS 导入~~ **不需要**（Zachary 2026-09-18 拍板：新 RDS 只需建表结构，不迁移 dev 环境的旧数据）。改为对新 RDS 跑 `test2` 分支代码的 C# EF Core 迁移（2026-09-18 已执行完成）：本地开 SSH 隧道到 `stayright-prod-bastion`（`3.105.155.148`）转发到 RDS，`ASPNETCORE_ENVIRONMENT=Production RUN_DB_MIGRATE=1 dotnet run` 建表 + 触发启动时的 seed/RAG backfill（`SeedRunner`/`RagChunkBackfill` 在空库首次启动时自动跑）。表结构、演示种子数据、RAG chunk embedding 均已写入 prod RDS
- [x] EC2 跳板机已建（`i-06c845e0f6440716b` + EIP `3.105.155.148`，SSH key 认证，见 `AWS_SDK_SPEC.md` §8.1）。⚠️ **永久无法挂 IAM role**（`ICTGSStudentPermissionSet` 的 IAM 权限边界已向 Zachary 确认为课程侧定死、无法申请修改，非临时受限）；C# 部署到这台机器时怎么读 Secrets Manager/SSM 已拍板：人工注入（见下方部署条目）
- [x] C# 后端已部署到 `stayright-prod-bastion` 这台 EC2（2026-09-18，用 **`test2` 分支**代码，不是 `main`——本次首个 prod 部署明确不走 CI/CD，等真正接入 CodePipeline 才切回 `main`）。这台机器此前从没跑过这个应用，是彻底的从零初始化：`dotnet publish -r linux-x64 --self-contained` 打包 → 传到 `stayright-prod-raw-025066268612` S3 桶 → 预签名 URL 下载到 EC2 → 手写 `/etc/systemd/system/stayright-api.service`（此前不存在；`scripts/deploy-backend.sh` 假设的原子换目录/已有 systemd 服务是给旧 dev EC2 写的，这台全新机器要先建）→ 手动写 `/opt/stayright/.env`（DB 连接串直连 RDS + Gemini/Bedrock model ID/SMTP/`INGEST_SHARED_KEY`，密钥来自 Secrets Manager 由我用 CLI 取出人工写入文件，应用运行时不调用 Secrets Manager API，符合 §8.1 例外）。⚠️ 踩坑：Amazon Linux 2023 精简镜像缺 `libicu`，.NET 启动直接 core dump（`Couldn't find a valid ICU package`），`sudo dnf install -y libicu` 解决。服务已 `systemctl enable`（开机自启），`curl localhost:5080/api/auth/me` 返回预期 403。SMTP 复用本地开发 `.env` 里现有的 QQ 邮箱账号（Zachary 确认不单独建 prod 专用邮箱）。⚠️ **`scripts/deploy-backend.sh` 本身未改**——它走 `aws ssm send-command`，prod EC2 永久没有 IAM instance role、SSM RunCommand 用不了，本次是手动 SSH 走的等价流程；后续要接入自动化部署，这个脚本需要针对 prod 账户重写投递方式（SSH 而非 SSM），且需要补上"首次部署建 systemd 服务"这一步（目前脚本假设服务已存在）
- [x] ~~4 个采集器 Lambda（weather/volcano/flight/road）用 `detect/template.yaml` 独立 `sam deploy` 到新账户~~ **架构改道（Zachary 2026-09-18 拍板）**：`sam deploy` 需要给每个函数建 IAM 执行角色（`iam:CreateRole`），实测这个账户的登录身份对 IAM **彻底锁死**——不仅不能建新角色，连挂载任何已有角色（`iam:PassRole`，测过好几个候选角色，包括账户里几个疑似课程预留的通用角色，全部 `AccessDenied`）都不行，这是账户级永久限制，不是本次会话的权限问题。改为**4 个采集器都跑在 `stayright-prod-bastion` 这台 EC2 上，用 `cron` 代替 EventBridge Scheduler**（频率对齐 `template.yaml`：weather 15 分钟一次，其余三个每天一次）。配套给 `detect/src/adapters/config.py`/`secrets.py` 的 `cfg()`/`secret()` 加了环境变量优先的读取路径（同名环境变量存在就直接用，不再打 SSM/Secrets Manager）——因为 EC2 同样没有 IAM instance role，`cfg()`/`secret()` 原本无条件调 boto3 会因缺凭证失败，这是跟 C# 后端一样的"密钥人工注入"例外的延伸。详见 `docs/AWS_SDK_SPEC.md` §13.2 2026-09-18 条目
- [x] CloudFront + S3 前端已部署（2026-09-18）。**未直接复用 `scripts/deploy-frontend.sh`**——该脚本假设 CloudFront 分发已存在（只做 S3 sync + invalidation），这次是全新账户第一次建分发，手动建了 OAC + 双源站分发（S3 走 OAC 私有访问、`/api/*` 转发到后端 EC2）。前端构建/上传步骤跟脚本逻辑一致（`VITE_API_BASE_URL=""` 走同源相对路径，hash 资源 immutable 长缓存、`index.html`/`favicon.svg` no-cache）。见 §13.2 完整记录
- [x] ~~建开发团队 prod DB 隧道权限：4 个原生 IAM User~~ **已放弃**——`ICTGSStudentPermissionSet` 无 IAM 写权限，建不了 IAM User 也建不了 EC2 instance role，SSM 隧道方案整体作废。改为 Zachary 一人持有 EC2 SSH key 手动管理数据库，见 `AWS_SDK_SPEC.md` §8.1
- [ ] （待定，非本清单强制）团队本地开发若要统一连 prod 库，需要另写 SSH 版隧道脚本 + 项目连接串模板，且需先确认私钥怎么安全分发给其他 3 位成员

## 脚本联调（改造后的脚本不再有 dev 账户默认值，必须显式传参）

- [x] ~~`EC2_INSTANCE_ID=<新账户实例ID> RAW_BUCKET=<新账户bucket> scripts/deploy-backend.sh`~~ **脚本已删除（2026-09-18）**——走 `aws ssm send-command`，跟 prod 账户永久不兼容（EC2 无 IAM instance role）。首次部署改用手动 SSH，见 `docs/AWS_SDK_SPEC.md` §13.2；以后要自动化部署，需要新写 SSH 投递版本
- [x] `scripts/deploy-frontend.sh`——已实测跑通（2026-09-18），`SITE_BUCKET`/`CF_DIST_ID` 默认值已改成指向 prod（仍可传参覆盖）
- [x] ~~`EC2_INSTANCE_ID=<新账户实例ID> scripts/db-tunnel.sh`（本地联调用；`db-tunnel-install.sh` 同理）~~ **两个脚本已删除（2026-09-18）**——同样走 SSM，跟 prod 不兼容。本地/DBeaver 连库改用 SSH 隧道，见 `docs/DATABASE_ACCESS.md` §3.2
- [x] `scripts/seed-hotels.sh` / `scripts/clean-demo-state.sh`——纯 HTTP 请求，`BASE` 默认值已改成指向 prod CloudFront 域名，2026-09-18 实测跑通。~~`seed-demo-full.sh`/`seed-demo-second-case.sh`~~ **已删除**——内部用 `aws ssm send-command`（插演示预订）+ `aws lambda invoke`（触发天气采集器），跟 prod 不兼容（无 IAM role、Lambda 采集器已改 EC2 cron 不存在了）。演示注水目前只能靠 `seed-hotels.sh`
- [ ] 如需重新走 CI/CD bootstrap：`ACCOUNT_ID=<新账户ID> RAW_BUCKET=... SITE_BUCKET=... CF_DIST_ID=... EC2_INSTANCE_ID=... infra/bootstrap-cicd.sh`——尚未针对 prod 账户跑过，目前所有部署都是手动做的

## 移动端协同

- [ ] 新账户的 API 入口地址（API Gateway/Function URL 或 CloudFront `/api/*`）确定后，同步给移动端团队写入 App 配置；明确该地址后续变更需要提前协调（原生 App 换后端地址成本高于网页端热更新）
- [ ] （跨团队依赖，非本清单负责范围）移动端团队需要自行解决 Cookie-based 认证在原生 App 场景下的可用性问题——记录为已知阻塞项，不在本次 AWS 账户搭建里处理

## 已知阻塞（需要 tutor/课程管理员协助，账户内无法自行解决）

- [ ] **Bedrock 被组织级 SCP 显式拒绝**（2026-09-18 发现）：`bedrock:InvokeModel` 报错指向组织管理账号 `801934657318` 的 SCP 显式拒绝，不是本账户内 model access 开关或 IAM 权限能解决的。需要找 tutor 确认能否针对 `ictgs-team5` 放开。不阻塞现状（Gemini 主路径不受影响，只影响 fallback），暂不算紧急
- [ ] **IAM 彻底锁死**（2026-09-18 发现）：`iam:CreateRole`/`iam:PassRole`/`iam:GetRole` 等全部 `AccessDenied`，导致 Lambda 采集器方案作废（已改跑 EC2 cron，见「基建搭建」）。若未来需要真正的 Lambda/Serverless 架构，需要 tutor 协助开权限或代建角色

## 收尾

- [ ] 确认没有把任何新账户的 account ID / instance ID / 长期密钥提交进 Git（`git status`/`git diff` 检查一遍）
- [ ] 更新 `CLAUDE.md` 技术栈表和 `docs/AWS_SDK_SPEC.md` §13.2 部署时间线，补记新账户的实际部署过程（沿用现有"现状要同步更新，别让文档漂移"的维护约定）
