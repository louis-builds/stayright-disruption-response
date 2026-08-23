# 数据库连接与管理指南

> 适用对象：StayRight NZ 全体开发者 ｜ 最后更新：2026-08-21
> 数据库形态：PostgreSQL 16 + PostGIS 3.4 + pgvector 0.8（**不用 ORM**，驱动 `psycopg` v3）

---

## 0. 先搞清楚你要连哪个库

**九成情况下你连的是自己电脑上的库，不是线上那个。**

| | 场景 A · 本地开发库 | 场景 B · 线上库（EC2） |
|---|---|---|
| 什么时候用 | 写代码、跑单测、试 SQL、改 schema | 集成验证、排查线上数据、演示彩排 |
| 谁能用 | **所有人，立刻** | 需要 Zachary 发 IAM 权限 |
| 需要 AWS 账号 | ❌ 不需要 | ✅ 需要 |
| 数据 | 自己的，随便删 | **共享的，改之前先说一声** |
| 章节 | §1 → §2 → §3 | §4 → §5 |

> ⚠️ **不要五个人连同一个开发库。** 很快会变成"谁把我的表 drop 了"。本地库和线上库版本、扩展、schema 完全一致，本地跑通线上就能跑。

---

# 场景 A · 本地开发库

## 1. 装 Docker

### macOS

```bash
brew install --cask docker
open -a Docker          # 首次启动要点几下同意
```

没有 Homebrew 的话先装：
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Windows

用 winget（Windows 10/11 自带）：

```powershell
winget install Docker.DockerDesktop
```

或到 <https://www.docker.com/products/docker-desktop/> 下载安装包。

⚠️ **Windows 必须启用 WSL 2**。Docker Desktop 安装时会提示，按它说的做；如果它让你重启，就重启。装完在 PowerShell 里验证：

```powershell
docker --version
```

---

## 2. 起数据库容器

镜像和线上完全一致。⚠️ **`postgis/postgis` 镜像不含 pgvector，必须补装**——这是实测踩过的坑。

### macOS / Linux

```bash
docker run -d --name sr-pg --restart unless-stopped \
  -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=stayright \
  -p 5432:5432 -v sr-pgdata:/var/lib/postgresql/data \
  postgis/postgis:16-3.4

# 等容器起来
sleep 20

# 补装 pgvector
docker exec sr-pg bash -c "apt-get update -qq && apt-get install -y -qq postgresql-16-pgvector"
docker restart sr-pg && sleep 15

# 建扩展 + 应用用户（用户名必须是 app，与代码里的 DSN 一致）
docker exec sr-pg psql -U postgres -d stayright -c "
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE ROLE app LOGIN PASSWORD 'devpassword';
  GRANT ALL ON DATABASE stayright TO app;
  GRANT ALL ON SCHEMA public TO app;"
```

### Windows（PowerShell）

PowerShell 用反引号 `` ` `` 续行，不是反斜杠：

```powershell
docker run -d --name sr-pg --restart unless-stopped `
  -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=stayright `
  -p 5432:5432 -v sr-pgdata:/var/lib/postgresql/data `
  postgis/postgis:16-3.4

Start-Sleep -Seconds 20

docker exec sr-pg bash -c "apt-get update -qq && apt-get install -y -qq postgresql-16-pgvector"
docker restart sr-pg
Start-Sleep -Seconds 15

docker exec sr-pg psql -U postgres -d stayright -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS vector; CREATE ROLE app LOGIN PASSWORD 'devpassword'; GRANT ALL ON DATABASE stayright TO app; GRANT ALL ON SCHEMA public TO app;"
```

### ✅ 验收（两个系统相同）

```bash
docker exec sr-pg psql -U postgres -d stayright -c "\dx"
```

必须看到 `postgis` 和 `vector` 两行。看不到就是补装那步失败了，重跑一遍。

### 日常操作

| 动作 | 命令 |
|---|---|
| 停 | `docker stop sr-pg` |
| 起 | `docker start sr-pg` |
| 进 psql | `docker exec -it sr-pg psql -U app -d stayright` |
| **推倒重来** | `docker rm -f sr-pg && docker volume rm sr-pgdata` 然后重跑 §2 |

---

## 3. 装 DBeaver 并连接

图形界面，能看表结构、直接改数据、画 ER 图，还能**把 PostGIS 几何渲染成地图**。

### 安装

| 系统 | 命令 |
|---|---|
| macOS | `brew install --cask dbeaver-community` |
| Windows | `winget install dbeaver.dbeaver` |

或到 <https://dbeaver.io/download/> 下载（选 **Community Edition**，免费）。

### 新建连接

左上角**插头图标**（新建数据库连接）→ 选 **PostgreSQL** → 下一步 → 填：

| 字段 | 值 |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `stayright` |
| Username | `app` |
| Password | `devpassword` |
| Save password | ✅ 勾上 |

点 **Test Connection** → 显示 `Connected` 和 `PostgreSQL 16.x` → **Finish**。

> 首次会提示下载 PostgreSQL JDBC 驱动，点同意。

### 三个常用功能

| 功能 | 怎么用 |
|---|---|
| 看表结构 | 双击表 → **Properties** 标签页（列、约束、索引、外键） |
| **直接改数据** | 双击表 → **Data** 标签页 → 双击单元格改 → `Cmd/Ctrl + S` 提交 |
| **看地图** 🗺️ | 点几何列的单元格，右侧值面板会渲染成地图——看房源分布、影响范围很直观 |
| ER 图 | 右键表 → View Diagram |
| 跑 SQL | `Cmd/Ctrl + ]` 开编辑器，`Cmd/Ctrl + Enter` 执行 |

### 你会看到的系统对象（不是你们的表）

刚建好的库里已经有一些东西，别以为搞错了：

| 对象 | 来源 | 说明 |
|---|---|---|
| `public.spatial_ref_sys` | PostGIS | 全球坐标系定义，约 8500 行。**项目统一用 SRID `4326`**（WGS84 经纬度） |
| `tiger` / `tiger_data` schema | `postgis_tiger_geocoder` | 美国地址地理编码，本项目用不上 |
| `topology` schema | `postgis_topology` | 拓扑分析，用不上 |

业务表都建在 `public` schema 下。

---

# 场景 B · 连线上库（EC2）

> 🔴 **先决条件**：需要 AWS IAM 用户 + `ssm:StartSession` 权限。**找 Zachary 申请**，说明你要做什么。
> 日常开发不需要这个——只有集成验证、排查线上数据时才用。

## 4. 装 AWS CLI 与 Session Manager 插件

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

## 5. 开隧道并连接

### 5.1 确认实例开着

线上 EC2 **按需开停**，平时是停机状态。先问 Zachary，或者自己查（需要 `ec2:DescribeInstances` 权限）：

```bash
aws ec2 describe-instances --profile stayright --region ap-southeast-2 \
  --filters "Name=tag:Name,Values=stayright-dev-box" \
  --query 'Reservations[0].Instances[0].[InstanceId,State.Name]' --output text
```

状态不是 `running` 就找 Zachary 开机。

### 5.2 开端口转发

**新开一个终端窗口，这个窗口要一直挂着**——关掉隧道就断。

**macOS / Linux：**

```bash
aws ssm start-session --profile stayright --region ap-southeast-2 \
  --target <实例ID> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5432"],"localPortNumber":["15432"]}'
```

**Windows（PowerShell，注意 JSON 的引号要转义）：**

```powershell
aws ssm start-session --profile stayright --region ap-southeast-2 `
  --target <实例ID> `
  --document-name AWS-StartPortForwardingSession `
  --parameters '{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"15432\"]}'
```

看到 `Waiting for connections...` 就成功了。

### 5.3 在 DBeaver 里新建第二个连接

和 §3 一样，只改两处：

| 字段 | 值 |
|---|---|
| Port | **`15432`** ← 不是 5432 |
| 连接名 | 建议改成 **`stayright-线上`**，和本地库区分开 |

其余（Database / Username / Password）相同。

> 💡 用 **15432** 这个本地映射端口，是为了让本地库和线上库能同时开着互不打架。

### 5.4 用完关掉隧道

回到隧道那个终端按 `Ctrl + C`。

---

## 6. 线上库的使用纪律

| 规则 | 原因 |
|---|---|
| 🔴 **改数据前先在群里说一声** | 共享库，别人可能正在用 |
| 🔴 **不要在线上库跑 `DROP` / `TRUNCATE`** | 需要清理找 Zachary |
| 🔴 **schema 变更一律走迁移脚本**，不要在 DBeaver 里手动改表 | 手改不进 Git，下次重建就没了 |
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

```
db/migrations/
├── 001_init.sql
├── 002_add_policy_rules.sql
└── ...
```

| 规则 | 说明 |
|---|---|
| 每次变更一个新文件，**编号递增，只增不改** | 已合并的迁移文件不许再动 |
| 文件里写 `CREATE TABLE IF NOT EXISTS` 之类的幂等语句 | 重复执行不报错 |
| **本地先跑通再提 PR** | 别拿线上库当试验场 |
| 迁移涉及数据删除的，PR 描述里必须写清楚 | 评审要看得见 |

## 7.5 给 AI 的设计要点

设计新表或写查询前，先确认这几件事：

1. 有没有空间字段？→ 用 `geometry(..., 4326)` + GiST 索引
2. 有没有向量字段？→ 用 `vector(N)` + HNSW 索引，**不要**用 Bedrock Knowledge Bases
3. 时间字段是不是 `timestamptz`？
4. 查询里所有参数是不是命名参数？
5. 这张表会不会被 SQS 消费者并发写？→ 需要幂等键（见 `processed_events` 模式）
6. 新表是不是要加进 `db/migrations/` 的新编号文件？

---

## 8. 常见问题

| 现象 | 原因 | 解法 |
|---|---|---|
| `Connection refused`（本地） | 容器没起 | `docker start sr-pg` |
| `Connection refused`（线上） | 隧道断了 | 重开 §5.2，那个终端不能关 |
| `role "app" does not exist` | §2 最后一步没执行 | 重跑那条 `CREATE ROLE` |
| `extension "vector" is not available` | pgvector 没补装 | 重跑 §2 的 `apt-get install postgresql-16-pgvector` |
| `SessionManagerPlugin is not found` | 插件没装或 PATH 没刷新 | 见 §4，Windows 装完要重开终端 |
| `TargetNotConnected` | EC2 停机中 | 找 Zachary 开机 |
| `An error occurred (AccessDenied)` | IAM 缺 `ssm:StartSession` | 找 Zachary 加权限 |
| 端口 5432 被占用（Windows） | 本机装过 PostgreSQL | 改容器映射为 `-p 5433:5432`，DBeaver 连 5433 |
| Docker 在 Windows 起不来 | WSL 2 没装/没启用 | 以管理员运行 `wsl --install`，重启 |

---

## 附：连接信息速查

| | 本地开发库 | 线上库（经隧道） |
|---|---|---|
| Host | `localhost` | `localhost` |
| Port | `5432` | **`15432`** |
| Database | `stayright` | `stayright` |
| User | `app` | `app` |
| Password | `devpassword` | 见 Secrets Manager `stayright/dev/db/password` |
| 代码里的 DSN | `postgresql://app:{secret('db/password')}@localhost:5432/stayright` | 同左（代码永远连本机 5432，因为它跑在 EC2 上） |

> 代码里**绝不硬编码密码**，一律 `secret("db/password")` 从 Secrets Manager 读。详见 `docs/AWS_SDK_SPEC.md` §4.3。
