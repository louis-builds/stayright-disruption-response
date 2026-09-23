# 数据库连接与管理指南

> 适用对象：StayRight NZ 全体开发者 ｜ 最后更新：2026-09-10
> 数据库形态：PostgreSQL 16 + PostGIS 3.4 + pgvector 0.8（**不用 ORM**，驱动 `psycopg` v3）

---

## 0. 只有一个库：prod EC2（`stayright-prod-bastion`）背后的 RDS `stayright` 库

> ⚠️ **2026-09-18 更新**：本节下方 §2–§3 描述的是**旧 dev 账户（990393187001，已下线）**的 SSM 隧道连法，`scripts/dev.sh`/`db-tunnel.sh`/`db-tunnel-install.sh` 三个脚本已删除（不兼容 prod 账户——prod EC2 永久没有 IAM instance role，SSM agent 注册不上，`aws ssm start-session` 用不了）。**现在的连法是 SSH 隧道**，见下方新 §3.2。§2 的 AWS CLI/Session Manager 插件安装步骤不再需要；§3.1 的开机确认步骤不适用（prod EC2 是跳板机，常驻不停机，直连 RDS）。

**2026-09-10 起（Zachary 拍板）：不再本地跑 Docker Postgres。** 本地开发经 SSH 隧道连 prod RDS 的 `stayright` 库。根目录 `docker-compose.yml` / `Dockerfile.postgres` 已删除。

| | 说明 |
|---|---|
| 谁能用 | 目前只有 Zachary 持有 EC2 跳板机的 SSH 私钥（`stayright-prod-bastion-key.pem`）——团队其他成员要连，找 Zachary 代为操作或申请私钥分发方案（尚未定，见 `docs/NEW_ACCOUNT_CHECKLIST.md`） |
| 数据 | **全员共享**，改数据前在群里说一声 |
| 连法 | SSH 隧道到跳板机 → 转发到 RDS 私有端点（§3.2）；也可以直接 SSH 进跳板机后本机装了 `psql` 直连 |
| schema 变更 | 只走 EF Core 迁移，且**默认不在本地自动执行**（§5） |

> 📌 **prod 实机形态**：真正的 RDS（PostgreSQL 16.15 + pgvector 0.8.2 + PostGIS 3.4.6），不是 EC2 上的 Docker 容器——跟旧 dev 账户"Postgres 跑在 EC2 Docker 容器里"的形态不一样。RDS 端点：`stayright-prod-db.cpua0yc0ue7o.ap-southeast-2.rds.amazonaws.com:5432`，非公开访问，只能从同 VPC 内（即从跳板机）连。跳板机 `stayright-prod-bastion` 常驻不停机（EIP `3.105.155.148`）。

---

## 1. 为什么共用一个库（背景）

- 本地库和线上库"版本一致"只是理论，实际总会漂移；共用一个库，"本地跑通线上必跑通"。
- 省掉每人一套 Docker + pgvector 补装的踩坑。
- 代价：schema 变更必须小心（见 §5），离线开发做不了，EC2 停机时开发受阻。

---

## 2. 装 AWS CLI 与 Session Manager 插件

线上数据库**只监听 `127.0.0.1`**，EC2 **不开任何入站端口**（没有 22，没有 5432）。唯一通道是 AWS Systems Manager 的端口转发。

### macOS

```bash
brew install awscli
brew install --cask session-manager-plugin
```

### Windows（PowerShell，以管理员身份运行）

```powershell
winget install Amazon.AWSCLI
```

Session Manager 插件 winget 没有，下载 MSI 安装：

<https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPlugin.msi>

装完**关掉 PowerShell 重新打开**（刷新 PATH），验证：

```powershell
aws --version
session-manager-plugin --version
```

### 配置凭证（两个系统相同）

Zachary 会给你 Access Key ID 和 Secret：

```bash
aws configure --profile stayright
```

| 提示 | 填什么 |
|---|---|
| AWS Access Key ID | Zachary 给的 |
| AWS Secret Access Key | Zachary 给的 |
| Default region name | **`ap-southeast-2`** ← 必须是这个 |
| Default output format | `json` |

验证：

```bash
aws sts get-caller-identity --profile stayright
```

能返回你的 ARN 就对了。

> 🔒 **Secret 只显示一次，也绝不要发到群里或贴进任何聊天工具。**

---

## 3. 开隧道

### 3.1 确认实例开着

线上 EC2 **按需开停**，平时是停机状态。先问 Zachary，或者自己查（需要 `ec2:DescribeInstances` 权限）：

```bash
aws ec2 describe-instances --profile stayright --region ap-southeast-2 \
  --filters "Name=tag:Name,Values=stayright-dev-box" \
  --query 'Reservations[0].Instances[0].[InstanceId,State.Name]' --output text
```

状态不是 `running` 就找 Zachary 开机。

### 3.2 SSH 隧道到 RDS（现行方式，2026-09-18 起）

prod EC2 跳板机没有 IAM instance role，`aws ssm start-session` 用不了——直接用 SSH 端口转发，私钥找 Zachary 要（`stayright-prod-bastion-key.pem`）。

**开隧道**（本地端口自选，不要跟本地其他服务冲突）：

```bash
ssh -i ~/.ssh/stayright-prod-bastion-key.pem -f -N \
  -L 15433:stayright-prod-db.cpua0yc0ue7o.ap-southeast-2.rds.amazonaws.com:5432 \
  ec2-user@3.105.155.148
```

`-f -N` 让它在后台跑不占终端。之后本地连 `localhost:15433` 就是连到 RDS。

**关隧道**：找到进程杀掉——`pkill -f "L 15433:stayright-prod-db"`（换成你自己起的端口号）。

**更简单：直接 SSH 进跳板机再连**（不用在本地开隧道，跳板机上已经装了 `psql`）：

```bash
ssh -i ~/.ssh/stayright-prod-bastion-key.pem ec2-user@3.105.155.148
psql "host=stayright-prod-db.cpua0yc0ue7o.ap-southeast-2.rds.amazonaws.com port=5432 dbname=stayright user=app"
```

密码从 Secrets Manager 取（需要 `ictgs-team5` 账户的 AWS 权限）：

```bash
aws secretsmanager get-secret-value --secret-id "stayright/prod/db/password" \
  --profile ictgs-team5 --region ap-southeast-2 --query SecretString --output text
```

**DBeaver 等 GUI 工具**：用它们自带的 SSH 隧道功能（连接配置里的 "SSH" 标签页），主机/用户名/私钥填跳板机信息，数据库连接信息填 RDS 真实地址，不用手动开隧道、不用改成 `localhost`——工具自己处理。

### 3.2b 给团队其他成员开通访问（2026-09-23 起）

这个账户对 IAM 彻底锁死（课程侧永久边界），没法走"4 个 IAM User"那条路——最终方案是 **OS 级 SSH key 管理**：每个开发者用自己的密钥对，Zachary 手动把对方的公钥加进跳板机的 `authorized_keys`，并加上限制，让这把 key **只能转发到 RDS:5432，登不了 shell、跑不了命令**。不需要改安全组，也不需要任何 IAM 权限。

完整流程（开发者要做什么、Zachary 要跑什么脚本、密码怎么单独分发、怎么撤销权限、安全边界说明）见 **`docs/TEAM_DB_ACCESS.md`**，不在这里重复——避免两份文档各改一半、内容漂移。配套脚本：`scripts/add-dev-ssh-key.sh`。

### 3.3 用完

隧道不是常驻服务，不用时随手关掉（见上方"关隧道"）。跳板机本身常驻不停机，不需要通知谁开关机。

---

## 4. 用 DBeaver 看库（可选）

图形界面，能看表结构、直接改数据、画 ER 图，还能**把 PostGIS 几何渲染成地图**。

| 系统 | 安装 |
|---|---|
| macOS | `brew install --cask dbeaver-community` |
| Windows | `winget install dbeaver.dbeaver` |

新建连接（插头图标 → PostgreSQL），隧道开着的前提下填：

**推荐用 DBeaver 自带的 SSH 隧道**（连接向导的 "SSH" 标签页填跳板机信息：主机 `3.105.155.148`、端口 `22`、用户名 `ec2-user`、认证方式选公钥、私钥选 `stayright-prod-bastion-key.pem`），"主要" 标签页直接填 RDS 真实信息，不用手动开隧道：

| 字段 | 值 |
|---|---|
| Host | `stayright-prod-db.cpua0yc0ue7o.ap-southeast-2.rds.amazonaws.com` |
| Port | `5432` |
| Database | `stayright` |
| Username | `app` |
| Password | 见 Secrets Manager `stayright/prod/db/password`（找 Zachary，或有 `ictgs-team5` 权限自己取） |

（如果是自己手动开的 SSH 隧道，见 §3.2，Host 填 `127.0.0.1`、Port 填你自己起隧道时用的本地端口）

点 **Test Connection** → `Connected` → **Finish**（首次会提示下载 JDBC 驱动，同意）。

常用：双击表 → **Properties** 看结构 / **Data** 改数据（`Cmd/Ctrl+S` 提交）；
点几何列单元格右侧值面板渲染成地图；`Cmd/Ctrl+]` 开 SQL 编辑器。

**系统对象**（不是业务表，别以为搞错）：`public.spatial_ref_sys`（PostGIS 坐标系，
项目统一 SRID `4326`）、`tiger` / `topology` schema（用不上）。业务表都在 `public` 下。

---

## 5. schema 变更：本地默认不自动迁移

全员共用一个库，如果每个人 `dotnet run` 都自动跑 EF 迁移，一个人分支上未合并的迁移
就会打到大家共用的库上。所以：

- **`backend/Program.cs` 默认不执行迁移/seed**——只有 `ASPNETCORE_ENVIRONMENT=Production`
  （EC2 部署）或显式 `RUN_DB_MIGRATE=1` 时才跑。
- 日常本地开发：直接 `dotnet run`，只连库、不动 schema。
- 要应用自己的新迁移做本地验证：`RUN_DB_MIGRATE=1 dotnet run`。⚠️ **这会改共用库**——
  确保迁移已经过 review、准备合并；改完在群里说一声。
- 正式的 schema 变更由部署流水线在合并进 `main` 后执行。
- `docs/AWS_SDK_SPEC.md` / 本文 §7.4 提到的 `db/migrations/NNN_xxx.sql` 那套原始 SQL
  迁移**没有在用**（`db/` 目录不存在），schema 唯一来源是 `backend/Migrations/*.cs`。

---

## 6. 线上库的使用纪律

| 规则 | 原因 |
|---|---|
| 🔴 **改数据前先在群里说一声** | 共享库，别人可能正在用 |
| 🔴 **不要跑 `DROP` / `TRUNCATE`** | 需要清理找 Zachary |
| 🔴 **schema 变更只走 EF 迁移**，不要在 DBeaver 里手动改表 | 手改不进 Git，下次重建就没了 |
| 🔴 **未合并的迁移不要 `RUN_DB_MIGRATE=1` 打上去** | 见 §5 |
| 🟡 查询加 `LIMIT` | 别把大表全拉到本地 |
| 🟡 用完关隧道、通知可以停机 | EC2 按需开停省成本 |

---

# 7. 数据库设计与变更约定

> 这一节既是给人看的，也是**给 AI 看的**——设计表结构、写 SQL 时必须遵守。

## 7.1 硬约束

| 约束 | 说明 |
|---|---|
| **不用 ORM** | SQLAlchemy 等对 PostGIS / pgvector 函数支持差。一律裸 SQL + `psycopg` v3 |
| **命名参数 `%(name)s`** | 🚨 绝不用 f-string 拼 SQL（注入风险） |
| **不写 `SELECT *`** | 显式列名 |
| **空间计算交给数据库** | 用 `ST_Intersects` 等，不要把数据读进 Python 算距离——那样索引白建 |
| **SRID 统一 `4326`** | WGS84 经纬度。混用坐标系是空间查询最常见的错误来源 |
| **时间列一律 `timestamptz`** | 不用 `timestamp`；应用侧一律 `datetime.now(timezone.utc)` |
| **写回操作放在单个事务** | 取消原单 + 建新单 + 写审计必须原子 |

## 7.2 命名约定

| 对象 | 风格 | 例 |
|---|---|---|
| 表名 | `snake_case`，**复数** | `bookings`、`properties`、`policy_rules` |
| 列名 | `snake_case` | `booking_id`、`stay_start` |
| 主键 | `<单数表名>_id` | `booking_id` |
| 几何列 | `geom` | `geometry(Point, 4326)` / `geometry(Polygon, 4326)` |
| 向量列 | `embedding` | `vector(N)` |
| 索引 | `idx_<表>_<列>` | `idx_properties_geom` |
| 时间列 | `created_at` / `updated_at` | `timestamptz` |

⚠️ **领域术语以代码里的 dataclass 为准**（`DisruptionEvent`、`verdict`、`exec_id`、`entity_key`），不要另造同义词。同一概念不要出现两种写法（如 `booking_id` 和 `bid`）。

## 7.3 必须建的索引

| 场景 | 索引 |
|---|---|
| 空间匹配 | **GiST**：`CREATE INDEX idx_properties_geom ON properties USING GIST (geom);` |
| 向量检索 | **HNSW**：`CREATE INDEX ... USING hnsw (embedding vector_cosine_ops);` |
| 日期区间重叠 | 考虑 `daterange` + GiST |

没有 GiST 索引，`ST_Intersects` 会退化成全表扫描——2000 房源时还看不出来，量一大就崩。

## 7.4 schema 变更流程

> ⚠️ **现状**：schema 唯一来源是 `backend/Migrations/*.cs`（EF Core 迁移）。
> 下面这套 `db/migrations/NNN_xxx.sql` 原始 SQL 迁移**没有在用**（`db/` 目录不存在）。
> 执行时机与"本地默认不自动迁移"见 §5。

| 规则 | 说明 |
|---|---|
| 每次变更一个新迁移，**已合并的不许再改** | `dotnet ef migrations add <Name>` 生成 |
| **本地用 `RUN_DB_MIGRATE=1 dotnet run` 验证过再提 PR**（§5） | 共享库，别拿它当试验场 |
| 迁移涉及数据删除的，PR 描述里必须写清楚 | 评审要看得见 |
| 未合并进 `main` 的迁移不要打到共享库上 | 别人会撞上你的半成品表结构 |

## 7.5 给 AI 的设计要点

设计新表或写查询前，先确认这几件事：

1. 有没有空间字段？→ 用 `geometry(..., 4326)` + GiST 索引
2. 有没有向量字段？→ 用 `vector(N)` + HNSW 索引，**不要**用 Bedrock Knowledge Bases
3. 时间字段是不是 `timestamptz`？
4. 查询里所有参数是不是命名参数？
5. 这张表会不会被 SQS 消费者并发写？→ 需要幂等键（见 `processed_events` 模式）
6. 新表的 schema 变更是不是走 `backend/Migrations/` 的 EF 迁移？（`db/migrations/` 那套没在用，见 §5）

---

## 8. 常见问题

| 现象 | 原因 | 解法 |
|---|---|---|
| `Connection refused`（连 15432） | 隧道没开 / 刚断还没重连上 | 装了常驻服务的话等几秒会自动回来，看 `~/Library/Logs/stayright-db-tunnel.log`；没装就 §3.2 |
| 隧道反复断 | SSM 空闲超时 / 网络抖动 | 用 §3.2 的保活脚本而不是裸命令；让 Zachary 做 §3.3 |
| `TargetNotConnected` | EC2 停机中 | 找 Zachary 开机 |
| `SessionManagerPlugin is not found` | 插件没装或 PATH 没刷新 | 见 §2，Windows 装完要重开终端 |
| `An error occurred (AccessDenied)` | IAM 缺 `ssm:StartSession` | 找 Zachary 加权限 |
| 端口 15432 被占用 | 已经开着一个隧道，或残留进程 | `lsof -i:15432` 找到杀掉再重开 |
| 后端起来但报 `relation ... does not exist` | 本地分支有未应用的迁移 | 见 §5，确认无误后 `RUN_DB_MIGRATE=1 dotnet run` |

---

## 附：连接信息速查

| 字段 | 值 |
|---|---|
| Host | `127.0.0.1` |
| Port | **`15432`**（SSM 隧道本地端口） |
| Database | `stayright` |
| User | `app` |
| Password | 见 Secrets Manager `stayright/dev/db/password`（本地 `.env` 暂用 dev 口令，找 Zachary） |
| C# 连接串 | 由 `backend/Program.cs` 从 `POSTGRES_*` / `PG*` 环境变量拼，本地走根目录 `.env` |
| Python DSN | `detect/` 走 `PG*` 环境变量（同一个 `.env`），`psycopg` 原生读取 |

> 代码里**绝不硬编码密码**，一律 `secret("db/password")` 从 Secrets Manager 读。详见 `docs/AWS_SDK_SPEC.md` §4.3。
> EC2 上的应用（Production）连的是 `localhost:5432`（数据库容器同机），不走隧道。
