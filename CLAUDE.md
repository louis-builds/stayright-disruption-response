# Kakapo 项目开发标准

本文件由 Claude Code 在每次会话中自动加载，是团队与 AI 协作时的统一开发标准入口。**所有开发前，都应确保 AI 已加载本文件**（正常使用 Claude Code 时无需手动操作，会自动加载）。

> **本文件分两部分，所有权不同：**
> - **「AWS 与架构约束」** —— 由 Zachary 维护。这些是已定架构决策的落地要求，**改动前请先讨论**。
> - **其余章节（命名、格式化、测试、Git）** —— **团队共同决定**，标 TODO 的地方待大家确认后回填。

## 项目状态

场景：**StayRight NZ** —— 事件驱动的 AI 扰动响应系统（监测 NZ 扰动信号 → 匹配受影响订单 → 政策解算 → 推荐替代房源 → 15 分钟内主动通知 → 重订闭环 → 复杂案例转人工）。

技术栈已定，AWS 环境已搭好并通过冒烟验收（2026-08-21）。

**目录结构与实际代码的对应关系**（2026-08-31 核对代码后补充，2026-09-08 补记新增模块）：

| 目录 | 内容 | 对应 CI job |
|---|---|---|
| `detect/` | Python 3.12 采集器/检测逻辑（`src/`、`tests/`、`requirements.txt`、`pyproject.toml`） | `gate.yml` 的 `python` job |
| `detect/agent/` | ⚠️ 新增、未在本文件其他章节说明：`langgraph_framework.py`，基于 LangGraph 的"扰动处理 & 改签"agent 骨架（工具函数为占位桩）。不在 `src/` 下，靠 `sys.path.insert` 挂路径，游离于下文三层分层约束之外——架构定位待 Zachary 确认 | 未纳入 `gate.yml`（不在 `src/`，`pytest` 覆盖不到） |
| `detect/src/mcp_server/` | ⚠️ 新增、未在本文件其他章节说明：`identify_server.py`，MCP server，用途/调用方待补文档 | 随 `python` job 一并跑 pytest（若有对应测试） |
| `backend/` | .NET 服务（`backend.sln`、`Program.cs`、`Controllers/`、`Features/` 等） | `gate.yml` 的 `backend` job |
| `frontend/` | React + TypeScript + Vite 运营台（`package.json` 含 `lint`/`build`） | `gate.yml` 的 `frontend` job |

⚠️ **与下方「技术栈」表存在落差，待 Zachary 确认**：技术栈表只列了 Python 后端，未提及 `backend/` 下的 .NET 服务；这是架构表述滞后于代码演进，还是 `backend/` 属于非核心/待淘汰模块，需要 Zachary 明确后回填本文件，不要自行假设。

> 下表是**当前仓库的实际构成**。标「规划」的是既定方向但尚未落地，不要当成现状引用。

| 项 | 选型 |
|---|---|
| 主后端 API | **C# / .NET 9**（`backend/`：认证、订单、酒店、案件、聊天、协调台、handoff 摄入、FAQ/RAG） |
| 扰动管线 | **Python 3.12**（`detect/`：采集 → 归一化 `DisruptionEvent` → 匹配受影响订单 → 写 `handoff.jsonl`，由 C# 摄入） |
| 前端 | **React + TypeScript**（`frontend/`） |
| 数据存储 | **PostgreSQL + PostGIS + pgvector**。C# 侧走 EF Core + Npgsql（EF 迁移）；Python 侧用 `psycopg` v3、**不走 ORM** |
| 大模型 | 主用 **Gemini**（`backend/Features/Chat/GeminiClient.cs`）；**AWS Bedrock**（Claude Haiku）作为 fallback |
| AWS SDK | Python 侧 **boto3**（唯一）；C# 侧 AWS SDK for .NET（目前仅 Bedrock fallback 用到） |
| 云区域 | **`ap-southeast-2`（悉尼）** |
| CI | GitHub Actions（`.github/workflows/gate.yml`，触发分支 `Test`）：`pytest` + `dotnet build` + 前端 `lint`/`build` |
| 运行环境（规划） | EC2 模块化单体 + 5 个 Lambda（4 采集器 + 1 回调）。4 个采集器（weather/volcano/flight/road）已于 2026-09-03 随 SAM 栈 `stayright-dev-weather-collector` 部署上线并实测；回调 Lambda（第 5 个）代码未写、未部署。详见 `docs/AWS_SDK_SPEC.md` §13.2 部署时间线 |
| IaC（规划） | 非代码资源用脚本创建、Lambda 走 AWS SAM（`detect/template.yaml`）。`infra/` 目前是空占位 |
| CD（规划） | 合并即部署的流水线尚未建；`gate.yml` 只做检查、不做部署 |

---

# 🔴 AWS 与架构约束

> **维护人：Zachary。改动本节前请先讨论——这些不是风格偏好，是架构决策的落地要求。**
>
> 📖 **两份配套文档，写代码前按需读：**
> - `docs/AWS_SDK_SPEC.md` —— 完整 boto3 写法。涉及 S3 / SQS / EventBridge / Bedrock /
>   SES / CloudWatch / Lambda Function URL 的代码，先读对应小节。
> - `docs/DATABASE_ACCESS.md` —— 数据库连接（macOS / Windows 分别写）+ **设计与变更约定**。

## 本地开发不需要 AWS 账号

`detect/` 的测试不碰网络、不碰数据库——采集器的 `fetch_*` 在测试里被注入替换，matcher 用 mock 连接：

```bash
cd detect && .venv/Scripts/python -m pytest
```

**规划**：加一层 `STAYRIGHT_LOCAL=1` 开关，把 AWS 调用切到 `adapters/fakes.py` 的内存实现，让打真实 AWS 的运行时也能本地跑。目前 `fakes.py`、这个开关、`src/runtimes/worker` 都还没落地——`detect/src/adapters/` 里只有 `aws.py` / `config.py` / `secrets.py`，直接调 boto3。

**不要因为"AWS 还没给我权限"而停下来**，你不需要权限。真机验证（连线上库、跑真 AWS）时找 Zachary。

## 三条硬约束（务必遵守）

```
1. 业务逻辑层（规划中的 src/core/，当前为 src/detect/、src/identify/）里出现
   boto3 / psycopg / os.environ / datetime.now()
2. 代码里硬编码资源名（桶名、队列 URL、模型 ID、Account ID、ARN）
3. Bedrock 模型 ID 使用 global. 前缀
```

> 自动拦截（CI 守卫）尚未接入，目前靠 review + 提交前自检把关。

## 三层分层（不可协商）

```
src/core/       纯函数层。业务逻辑住在这里。
                禁止 import boto3 / psycopg / os.environ
                禁止调用 datetime.now()  ← 时间由调用方作为参数传入
                所有外部依赖都从参数传入

src/adapters/   与外部世界打交道的唯一入口
                aws / config / secrets / queue / bus / llm_bedrock /
                notify_ses / metrics / store_s3 / store_pg / fakes
                禁止写业务判断分支——判断一律回到 core/

src/runtimes/   进程外壳（EC2 worker / ttl_scanner / Lambda handlers）
                只做装配：读配置 → 调 adapters 取数据 → 调 core 算 → 调 adapters 落地
```

**为什么不可协商**：这条边界让 80% 的代码不依赖 AWS 知识，也是"将来把运行时从 EC2 迁回 Serverless 时业务代码一行不改"的唯一依据。规划用 CI 守卫自动拦截违规（尚未接入）。

**现状**：`detect/` 已建 `src/adapters/`（`aws`/`config`/`secrets`）和 `src/runtimes/`；业务逻辑目前在 `src/detect/` 和 `src/identify/`，尚未收敛进 `src/core/`。下文提到 `src/core/` 时即指这一层。

**拿不准某段代码该放哪一层就先问，不要猜。**

- 业务逻辑层覆盖率要求 **100%**（纯函数，无外部依赖，做得到）。这是分层设计的直接收益，也是它值得坚持的证明。
- **改动业务逻辑层（`src/core/` / 当前 `src/detect/`、`src/identify/`）的 PR 需要 Zachary review** —— 分层边界是架构可逆性的唯一保险。

## AWS 五条铁律

1. 资源名**绝不硬编码**，一律 `cfg("KEY")` 从 SSM 读（`/stayright/{STAGE}/{KEY}`，共 12 个 key）
2. 密钥一律 `secret("name")` 从 Secrets Manager 读（`db/password`、`token/hmac-key`、`oag/api-key`）
3. boto3 client 只从 `adapters/aws.py` 的 `client()` 拿，**模块级创建一次**
4. SQS **成功才 `delete_message`**；失败让异常抛出去，靠可见性超时自动重投
5. 区域固定 `ap-southeast-2`，不要在代码里写别的区域

## Bedrock 两条硬规则（用到 Bedrock 时 —— 目前是 Gemini 的 fallback 路径）

- **必须用推理配置文件 ID**（`au.` 前缀）。悉尼区多数新版模型不支持按需直调基础模型，会报 `ValidationException: on-demand throughput isn't supported`。
- **前缀只能 `au.` 或 `apac.`，禁止 `global.`** —— `global.` 会把数据路由出澳洲，违反 NZ 数据驻留要求。

> 这两条你都不需要在代码里判断——模型 ID 从 `cfg("BEDROCK_MODEL_ID")` 读，正确的值已经在 SSM 里。
> 换模型是改一个 SSM 参数的事，**代码一行不用动**。

## 🚫 禁止事项

| 禁止 | 原因 |
|---|---|
| 在 `src/core/` 里 import `boto3` / `psycopg` / 读 `os.environ` | 破坏分层，CI 直接失败 |
| **硬编码任何资源名**（桶名、队列 URL、总线名、模型 ID、Account ID、ARN） | 换 AWS 账户即全废；一律 `cfg("KEY")` 从 SSM 读 |
| 写 `AccessKey` / `SecretKey` 到代码或 `.env` | 线上用 IAM 角色，本地用假实现，任何场景都不需要长期密钥 |
| **Bedrock Knowledge Bases 的 quick-create** | 会静默创建 OpenSearch Serverless ≈ **$700/月**。向量检索一律用 pgvector |
| **`global.` 前缀的 Bedrock 模型** | 数据会路由出澳洲，违反数据驻留要求 |
| Python 侧用 ORM（SQLAlchemy 等） | PostGIS / pgvector 函数 ORM 支持差。C# 侧用 EF Core 不在此列 |
| f-string 拼 SQL | 注入风险。一律命名参数 `%(name)s` |
| `SELECT *` | 显式列名 |
| 🚨 `except: pass` | SQS 的重试与死信队列**完全依赖异常向上传播** |
| 裸 `datetime.now()` | 一律 `datetime.now(timezone.utc)` |
| 自己写 AWS 重试循环 | 用 `botocore.config.Config` 统一配置 |
| 在函数里 `boto3.client(...)` | 只能从 `adapters/aws.py` 的 `client()` 拿 |
| 用 `print()` 输出日志 | 用 `logging`，一行一个 JSON |

判断 AWS 错误用 `e.response["Error"]["Code"]`，**不要**匹配错误文本。

## 数据库

**设计表结构、写 SQL、指导他人连数据库时，先读 `docs/DATABASE_ACCESS.md`。**

那份文档的 §7「数据库设计与变更约定」是硬约束，要点：

- **本地开发用自己电脑上的 Docker 库**，不要连线上库
- 不用 ORM · 命名参数 `%(name)s` · 不写 `SELECT *` · 空间计算交给数据库
- **SRID 统一 `4326`**；几何列名 `geom`，向量列名 `embedding`
- 时间列一律 `timestamptz`
- 空间列必须建 **GiST** 索引，向量列必须建 **HNSW** 索引
- schema 变更：**现状**由 C# 后端的 EF Core 迁移（`backend/Migrations/*.cs`）负责，`dotnet run` 启动时自动 migrate + seed。`docs/DATABASE_ACCESS.md` §7.4 里 `db/migrations/NNN_xxx.sql` 那套原始 SQL 迁移目前**没有在用**（`db/` 目录不存在）——两套迁移路线怎么统一，待团队定
- ⚠️ 线上库是共享的：不要手动改表、不要 `DROP`/`TRUNCATE`

被问到"数据库怎么连"时，直接指向 `docs/DATABASE_ACCESS.md`，按对方的操作系统给对应章节，不要凭记忆重述命令。

## 必须遵循的模式

- **事件驱动管线**：采集 → 变化检测 → 匹配 → 闸门 → 裁决 → 触达 → 回调 → 重订
- **非对称自动化**：自动"给予"（退款、免费改订）可全自动；自动"剥夺"（拒赔、扣罚金）必须转人工
- **审计第一秒落库**：原始响应先落 S3 再解析；裁决必须带可追溯的政策原文片段（`source_span`）
- **幂等消费**：SQS 是至少投递一次，消费者必须先查幂等表
- **结构化输出**：需要模型返回结构化数据时用原生机制强制（Bedrock 用 `toolConfig` 工具调用，Gemini 用 function calling / response schema），**不要**让模型返回自由文本再用正则抠字段
- **领域术语统一**：`DisruptionEvent`、`verdict`、`exec_id`、`entity_key` —— 以 `docs/AWS_SDK_SPEC.md` 和代码里的 dataclass 为准，不要另造同义词

## 环境现状

AWS 环境已就绪（SSM / Secrets / S3 / SQS / EventBridge / Bedrock / SES / EC2+PostGIS+pgvector）。
Lambda ×5：4 个采集器（weather/volcano/flight/road）已于 2026-09-03 部署上线并实测；回调 Lambda（第 5 个）未写。详见 `docs/AWS_SDK_SPEC.md` §13.2。

⚠️ 两件最容易踩的：**SES 处于沙箱模式，每个新收件邮箱都要单独验证**；**EC2 按需开停，平时是停机状态**。
需要真机环境（连线上数据库、跑真 AWS、加 SES 收件邮箱）时找 Zachary。

## CI / 部署

目前只有 `.github/workflows/gate.yml`（触发分支 `Test`，PR + push）：

```
gate: pytest（detect/）+ dotnet build（backend/）+ 前端 lint & build
```

**部署流水线尚未建。** 下面是既定方向、未落地：

```
deploy: 打包 → S3 → SSM Run Command → EC2 重启服务
        sam build && sam deploy（5 个 Lambda）
```

规划里「不要手动登录 EC2 改代码——下次部署会覆盖掉」仍然成立。

## 提交前自检

见 `docs/AWS_SDK_SPEC.md` §10 的 grep 清单（可直接跑）。其中 `make lint` / `make test` 目前**没有 Makefile**，暂用 `cd detect && python -m pytest` 代替。

---

# 以下由团队共同决定

> 下面几节是通用框架，**标 TODO 的地方待团队讨论后回填**。
> 与上面「AWS 与架构约束」冲突时，以上面为准。

## 代码风格与命名规范

### 命名约定

- 命名要表达意图，避免缩写（除非是团队公认的缩写，如 `id`、`url`）。
- 布尔值变量/函数使用 `is`/`has`/`can`/`should` 等前缀。
- 常量使用全大写下划线，如 `MAX_RETRY_COUNT`。
- 避免同一概念在不同模块使用不同命名（如同时出现 `booking_id` 和 `bid`）。
- TODO：文件名与目录名的统一风格（Python 建议 `snake_case`，TypeScript 待定），确定后在此注明。

### 代码组织

- 单一职责：一个函数只做一件事；一个模块只负责一个领域。
- 避免过深的嵌套（建议不超过 3 层），优先使用提前返回（guard clause）简化逻辑。
- 相关代码放在一起（就近原则），避免为了"看起来整洁"而过度拆分文件。
- 不引入当前需求不需要的抽象层（YAGNI）：三行重复代码优于一个只用一次的过度设计的抽象。

### 格式化

- TODO：选定并接入自动格式化工具，在 CI 中强制检查。Python 建议 `ruff`（lint + format 一体），TypeScript 建议 `Prettier + ESLint`——**待团队确认**。
- 缩进、引号、分号等细节以自动格式化工具的输出为准，不做人工争论。

### 注释

- 默认不写注释；只有当代码本身无法表达"为什么这么做"时才写注释（例如非显而易见的约束、历史原因、绕过某个 bug 的 workaround）。
- 不写描述"做了什么"的注释——好的命名已经说明了这一点。
- 不写与当前任务、修复、调用方相关的注释（如"用于 X 功能""为修复 #123 添加"），这类信息应放在提交信息或 PR 描述中。

### 错误处理

- 只在系统边界（用户输入、外部 API、外部依赖）做校验和错误处理。
- 不为不可能发生的场景添加防御性代码；信任内部代码和框架的保证。

### TODO（待团队确认）

- [ ] 具体语言的命名规范细则
- [ ] Linter / Formatter 工具及配置文件
- [ ] `src/` 之外的目录结构约定
- [ ] 依赖管理规范（版本锁定策略等）

---

## Git 提交与分支规范

### 提交信息格式（Conventional Commits）

```text
<type>(<scope>): <subject>

[可选的正文，说明"为什么"而非"做了什么"]
```

**type 类型：**

| type       | 说明                     |
|------------|--------------------------|
| `feat`     | 新功能                   |
| `fix`      | 修复 bug                 |
| `refactor` | 重构（不改变行为）       |
| `docs`     | 文档变更                 |
| `test`     | 新增/修改测试            |
| `chore`    | 构建/工具/依赖等杂项变更 |
| `perf`     | 性能优化                 |

- subject 使用祈使句、简洁明了，不超过 50 字符，不以句号结尾。
- 一次提交只做一件事，避免把无关改动混在一起。
- 正文重点说明"为什么"这么改，而不是重复 diff 已经表达的"做了什么"。

### 分支命名

```text
<type>/<简短描述>
```

例如：`feat/user-login`、`fix/order-timeout`、`refactor/api-client`

- **集成分支：`Test`**（受保护，走 PR；`gate.yml` 在此触发）。`main` 目前基本不用，落后 `Test` 数十个 commit
- 功能/修复分支从 `Test` 切出，完成后通过 PR 合并回 `Test`
- 规划：合并到 `main` 自动部署 dev、tag `v*` 部署 demo —— 部署流水线尚未建，暂不适用

### PR 规范

- PR 标题遵循与提交信息相同的 type 前缀约定。
- PR 描述需包含：改动目的（why）、主要变更点、测试方式。
- 合并前需通过 CI 检查（TODO：具体检查项待 CI 配置确定后补充）。
- ⚠️ **改动业务逻辑层（`src/core/` / 当前 `src/detect/`、`src/identify/`）的 PR 需要 Zachary review**（见上文分层约束）。
- 避免超大 PR；单个 PR 尽量聚焦一个改动主题，便于 review。

### 其他约定

- 禁止 `git push --force` 到 `Test`/`main`/共享分支（特殊情况需团队确认）。
- 禁止跳过 pre-commit/CI 检查（`--no-verify` 等），如检查失败应修复根因而非绕过。
- 敏感信息（密钥、token、`.env` 等）严禁提交，提交前检查 `git status`/diff 确认无泄露。

---

## 测试要求

### 测试策略

- 新增功能需附带对应的单元测试；修复 bug 时优先添加能复现该 bug 的回归测试。
- 测试应覆盖：正常路径（golden path）、边界条件、异常/错误路径。
- 集成测试尽量使用真实依赖（如本地真实数据库），避免过度 mock 导致测试通过但生产环境失败。
- ⚠️ **AWS 侧例外**：一律用 `STAYRIGHT_LOCAL=1` 的假实现，**不要在 CI 里跑打真实 AWS 的测试**——会消耗账户额度，且 PR 阶段没有凭证。
- UI/前端改动：除单元测试外，需在浏览器中手动验证核心路径和边界情况；无法验证时应在 PR/回复中明确说明"未做浏览器验证"，不得仅凭类型检查/单测通过就宣称功能正常。

### 覆盖率要求

- ⚠️ **`src/core/` 100%**（架构要求，见上文分层约束）。
- TODO：`src/adapters/` 与前端的覆盖率门槛待团队确定。
- 覆盖率是辅助指标，不应为了凑数字写无意义的测试。

### 测试命名与组织

- 测试文件与被测代码保持镜像的目录结构（TODO：具体约定待确认）。
- 测试用例命名清晰表达"在什么条件下、期望什么结果"。

### 测试 TODO（待团队确认）

- [ ] 测试框架（Python 建议 `pytest`，前端待定）
- [ ] 覆盖率工具与门槛
- [ ] E2E 测试策略（如需要）
- [ ] 测试数据/环境管理方式

---

## 架构原则（通用）

- 新增依赖前先评估是否真的必要，避免引入功能重叠的库。
- 保持模块边界清晰，避免循环依赖。
- 不为假设的未来需求做过度设计；按当前实际需求实现，需要时再扩展。
- 关键架构决策（选型理由、权衡）应记录下来，避免后来者/AI 重复踩坑或做出不一致的决策。

---

## 维护约定

- 开发标准发生变化时，直接修改本文件并提交，不要私下口头约定。
- **「AWS 与架构约束」一节改动前请先与 Zachary 讨论**；其余章节团队可自行迭代。
- 新成员/新协作 AI 加入项目时，本文件即为唯一需要阅读的起点；AWS 细节读 `docs/AWS_SDK_SPEC.md`，数据库读 `docs/DATABASE_ACCESS.md`。
- **本仓库以本文件为准。** 父目录 `../CLAUDE.md`（描述的是早期 Google ADK / Gemini agent 原型）与本项目无关，被工具一起加载时忽略它。
- **本文件与 `docs/AWS_SDK_SPEC.md` 不要重复内容**——重复必然漂移，漂移的文档比没有文档更糟。本文件放约束，那份放写法。
- 本文件里凡是描述「现状」的地方（技术栈、环境、CI/部署），改动代码/基建后要同步更新，别让它变回一份漂移的文档。

## 更新记录

| 日期       | 变更       | 说明                     |
| ---------- | ---------- | ------------------------ |
| 2026-08-21 | 初始化文档 | 技术栈待定，先建立通用框架 |
| 2026-08-21 | 新增数据库章节 | 指向 `docs/DATABASE_ACCESS.md`（macOS / Windows 连接步骤 + 设计与变更约定） |
| 2026-08-21 | 回填技术栈 + 新增「AWS 与架构约束」 | 技术栈已定；新增三层分层、AWS 五条铁律、Bedrock 两条硬规则、禁止事项、必须遵循的模式、提交前自检；完整写法见 `docs/AWS_SDK_SPEC.md`。**风格 / 测试 / Git 等章节仍待团队确认** |
| 2026-09-03 | 对齐现状 | 技术栈表改为反映实际（C# .NET 后端 + Python `detect/` + React 前端 + Gemini 主 / Bedrock 备）；把未落地的部分（`adapters/fakes.py`、`STAYRIGHT_LOCAL`、`src/core/`、`src/runtimes/worker`、Makefile、CI 守卫、部署流水线）标为「规划」；Git 章节集成分支由 `main` 改为 `Test`；注明忽略父目录 `../CLAUDE.md`。**架构方向本身未改，仅对齐描述——「AWS 与架构约束」的实质改动仍需 Zachary 确认** |
