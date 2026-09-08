# 提案：把酒店退改政策纳入 RAG 向量检索

> 状态：**草案，待 Zachary review**
> 作者：Zachary（借 Claude 整理）
> 日期：2026-09-07
> 关联：PR #108（Upload the hotel's policies to S3，已合入 `Test`，未进 `Dev-Zachary`）、PR #91/#108 的 `HotelRefundPolicy` 链路

---

## 1. 背景与目标

我们想用 [ragas](https://docs.ragas.io/) 评测 RAG 层的**检索正确率**。评测方案本身依赖一个前提：客服聊天要能检索到**当前订单这家酒店**的退改政策。核对代码后发现现状不支持这一点——酒店政策根本不在向量检索的语料里。

本提案要解决的问题：

> 酒店通过平台上传自己的退改政策文档（PDF/docx/md）→ 系统解析、切片、embedding → 向量入库 → 客服聊天时，按订单酒店检索到对应政策原文，喂给 LLM 生成回答。

这是一次涉及 **pgvector、embedding 管线、检索改造** 的架构变更，按 `CLAUDE.md`「AWS 与架构约束」的约定，改动前需要 Zachary 拍板。

---

## 2. 现状（2026-09-07 核对代码）

### 2.1 RAG 检索链路

| 环节 | 实现 | 位置 |
|---|---|---|
| 语料 | 3 个平台通用 markdown：`使用说明` / `取消与改订政策` / `常见问题` | `backend/SeedData/rag/*.md` |
| 切片 | 按 markdown 二级标题 `\n## ` 切，一节一个 chunk，共约 13 个 | `KnowledgeBaseService.UploadDocumentAsync` / `RagChunkBackfill` |
| embedding | Gemini REST `gemini-embedding-001`，API key 走 env `GEMINI_API_KEY`；**上传时同步逐 chunk 调用**，在请求线程里 | `GeminiClient.EmbedAsync` |
| 存储 | `RagDocumentChunk.Embedding` 是 `float[]`（PG `real[]` 普通列），**无 pgvector、无 ANN 索引** | `Infrastructure/Data/Entities/RagDocumentChunk.cs` |
| 检索 | C# 里 `foreach` 遍历全部 chunk 算余弦相似度，取 **top-1**，`score < 0.5` 丢弃 | `ChatService.FindRelevantSnippetAsync` |

`RagDocumentChunk.cs` 注释明确写着：「不引入 pgvector 扩展 —— 语料量小…等语料规模真的大了再迁 pgvector」。

### 2.2 酒店政策（另一套，不走检索）

| 表示 | 用途 | 怎么被用到 |
|---|---|---|
| `HotelRefundPolicy.Content`（markdown 文本，PG） | 展示给客人/协调员；算取消违约金 | `CaseService` 里 `Content.Split("\n## ")` + `.Contains("refund")` 关键字命中，塞进 prompt / 违约金计算 |
| `HotelRefundPolicy.StructuredRulesJson` | 确定性违约金规则（免费小时数、比例、固定费） | `RefundPolicyRuleExtractor` 用 LLM 预填，前端人工确认 |
| `HotelRefundPolicy.SourceFileKey`（PR #108 新增） | 原始上传文件的 S3 归档引用 | 生成 1h 预签名 URL 供下载查看，**旁路**，S3 失败只记日志 |

**关键**：`ChatService.FindRelevantSnippetAsync` 只查 `RagDocument` 的 chunk，**完全不碰 `HotelRefundPolicy`**。聊天里要用到某家酒店的政策文本，靠的是 `CaseService` 的关键字匹配，不是向量检索。

### 2.3 PR #108 做了什么、没做什么

- **做了**：上传政策文件时，除了抠文本存 `Content`，额外把**原始文件二进制**丢进 S3（`hotel-policies/{hotelId}/{date}/{policyId}-{文件名}`），DB 存 `SourceFileKey`。
- **没做**：没有 embedding、没有切片、没碰 `FindRelevantSnippetAsync`。S3 里现在是一堆 PDF/docx 原件，纯冷备份 + 下载用途。

### 2.4 配置现状

backend 全线用裸 `Environment.GetEnvironmentVariable`（`GEMINI_API_KEY` / `BEDROCK_MODEL_ID` / `S3_POLICY_BUCKET`），**不走 SSM `cfg()`**；区域在 C# 里硬编码 `RegionEndpoint.APSoutheast2`。这与 `CLAUDE.md`「AWS 五条铁律」不一致——但这些铁律是为 Python `src/` 树写的，`backend/`（.NET）本身就是 `CLAUDE.md` 里标注的「架构表述滞后于代码演进」的待确认区。本提案不试图一次性对齐，只在下面「决策点」里点出。

---

## 3. 目标架构

```
酒店上传政策文件 (PDF/docx/md)
        │
        ▼
[1] 解析文本 (PolicyDocumentExtractor)  ──►  HotelRefundPolicy.Content  (不变，展示 + 违约金)
        │
        ├──►  [2] 原件归档 S3  (PR #108，不变)
        │
        └──►  [3] 分块  ──►  [4] 逐块 embedding  ──►  [5] 向量入库 (pgvector, 带 hotel_id 元数据)
                                                              │
                                                              ▼
客服聊天  ──►  FindRelevantSnippetAsync  ──►  [6] 按订单 hotel_id 过滤的向量检索
                                              (命中酒店政策优先，未命中回退平台通用文档)
```

新增/改动环节：`[3] 分块`、`[4] embedding`、`[5] pgvector 存储`、`[6] 带过滤的检索`。

---

## 4. 差距与决策点（需要 Zachary 定）

### D1. 向量存储：迁 pgvector，还是继续应用层暴力算？ ✅ 已决策（2026-09-08）

- **结论：已落地，走 pgvector。** Dev-Yang 在 PR #126（`36c485f`，2026-09-07）实现，已合并 `Test` → 本分支。
- 实现：`RagDocumentChunk.Embedding` 换成 `Pgvector.Vector`，DB 列 `vector(1024)`；检索改成 `RagRepository.FindNearestSnippetAsync` 里的 SQL `OrderBy(c => c.Embedding!.CosineDistance(query))`；建了 HNSW 索引（`idx_rag_document_chunks_embedding`，`faq_questions` 表同步处理）。
- 迁移分两步：`UsePgvectorEmbeddings`（先转 3072 维过渡，因超 HNSW 2000 维上限暂不建索引）→ `ShrinkEmbeddingsTo1024`（截断到 1024 维再建索引）。截断用的是 `gemini-embedding-001` 官方支持的 MRL（Matryoshka）截断，技术上站得住脚，但截断参数是否为团队有意选择，待与 Dev-Yang 确认。
- 原设想的「反方案（记技术债）」不适用，已直接实现正式方案。

### D2. embedding 的时机：同步 vs 异步

**⚠️ 实现层面的决策，Zachary 不拍板 —— 转开发团队讨论。**（2026-09-08：Zachary 不负责开发，此类问题以 issue/待讨论形式反馈给开发团队，由团队定实现方式；Zachary 只定架构/供应商/数据合规这类决策，见 D4。）

- 现状（2026-09-08 核对代码，D1 落地后未变）：
  - `KnowledgeBaseService.UploadDocumentAsync`（`backend/Features/Coordinator/KnowledgeBaseService.cs:22-62`）在 HTTP 请求线程里 `for` 循环逐 chunk `await gemini.EmbedAsync(...)`，全部完成后接着在同一请求里跑 `RunGoldenTestsAsync` 回归测试，再同步返回。没有并发、没有限流。
  - `HotelService.UploadRefundPolicyFileAsync`（`backend/Features/Hotel/HotelService.cs:282-316`）目前完全没有 embedding 环节，只解析文本 + S3 归档（旁路，失败只记日志）——要接入检索，这段要从零写。
- 风险：一份长 PDF 切出几十个 chunk，现在的写法是逐个串行调 Gemini，酒店端上传接口本来就要等 S3 归档 + 结构化规则抽取（`WithAutoExtractedRulesAsync`），叠加几十次串行 embedding 调用容易卡到几十秒甚至网关超时。KB 上传路径已经有这个问题，酒店政策上传如果照搬同一模式，问题只会更明显。
- 两个方向供团队评估（不是 Zachary 的选择，仅供讨论参考）：
  - **同步 + 限流**：改动小、与现有 KB 上传写法一致，只是加并发数限制和超时保护；长文档仍有超时风险。
  - **异步（后台 worker / SQS）**：更贴合项目「事件驱动 + 幂等消费」的既定模式，但要处理「政策已保存、向量还没生成」的中间态——这段时间检索命中不到该酒店专属条款时应该怎么表现（回退通用文档 / 提示处理中）。
- **待开发团队反馈**：选哪个方向、KB 上传路径现有的同款问题要不要一并修、中间态怎么处理。

### D3. 分块策略：`Split("\n## ")` 不够用

**⚠️ 实现层面的决策，Zachary 不拍板 —— 转开发团队讨论。**（分块粒度/算法属于实现细节，同 D2。）

- 现状（2026-09-08 核对代码，D1 落地后未变）：切片逻辑（`KnowledgeBaseService.UploadDocumentAsync` 里的 `Split("\n## ")`，`backend/Features/Coordinator/KnowledgeBaseService.cs:34`）假设输入是带 `## ` 二级标题的 markdown。
- `PolicyDocumentExtractor.Extract`（`backend/Features/Hotel/PolicyDocumentExtractor.cs`）对 `.pdf` 是 `string.Join("\n", 每页文字)`（第 28 行）、对 `.docx` 是 `string.Join("\n", 所有 Text 节点)`（第 35 行）——**两者都不产生 `## ` 标题**。`.md`/`.txt` 原样透传，若文件本身没有 `## ` 也是同样问题。
- 后果：酒店政策上传接口目前还没接分块/embedding（见 D2），但一旦接上，若直接复用 `KnowledgeBaseService` 现成的 `Split("\n## ")` 逻辑，PDF/docx/无标题的政策文件会被当成 1 个巨型 chunk 整体 embed——语义稀释、检索命中率差，尤其是长政策文档。我们提供的 4 个样例政策本身也是无标题纯文本，同样会踩这个问题。
- 待团队评估的方向（不是 Zachary 的选择，仅供讨论参考）：
  - 加一个「无结构文本」fallback 分块器——按段落或固定 token 窗口切（例如 300~500 token，重叠 50），markdown 仍优先按 `## ` 切。
  - 需要定的参数：目标 chunk 大小、是否重叠、以及 embedding 模型的输入长度上限（`gemini-embedding-001` 约 2048 token，超限如何截断/拆分）。
- **待开发团队反馈**：分块器放在哪一层（`KnowledgeBaseService` 复用还是酒店政策独立一套）、具体的切分参数、以及是否需要为 PDF/docx 补语义分段（按标题字体大小/加粗识别小标题）而不是纯粹按 token 数硬切。

### D4. embedding 供应商：Gemini vs Bedrock ✅ 已决策（2026-09-08，Zachary）

- **结论：维持 Gemini（`gemini-embedding-001`）作为唯一 embedding 供应商，不切 Bedrock Titan。** 现有 `vector(1024)` 存量数据不需要因换供应商重算。
- 遗留风险（已知，接受）：酒店退改政策文本会经 Gemini API 发送到 Google，与 CLAUDE.md「NZ 数据驻留」精神存在张力，但团队评估后判定当前不需要为此切供应商。若未来政策文档被归类为需要 NZ 境内处理的敏感数据，需重新评估本决策（届时涉及向量维度变化、存量重算）。
- **建议**：借这次改造统一到 Bedrock Titan Embeddings，避免政策文本出境；维度锁定后写进 SSM。

### D5. 检索范围：按 hotel_id 过滤

**⚠️ 实现层面的决策，Zachary 不拍板 —— 转开发团队讨论。**（数据模型/查询逻辑属于实现细节，同 D2/D3；但其中「酒店专属 vs 通用文档优先级」牵涉产品行为，标出来供团队讨论时一并确认要不要请 Zachary 或产品侧过一遍。）

- 现状（2026-09-08 核对代码）：`RagDocumentChunk` 没有 `hotel_id` 列（`backend/Infrastructure/Data/Entities/RagDocumentChunk.cs`），`RagRepository.FindNearestSnippetAsync` 的检索完全不按酒店过滤。`HotelRefundPolicy`（`backend/Infrastructure/Data/Entities/HotelRefundPolicy.cs`）目前是独立表，靠 `HotelId` 关联酒店，但完全没有并入向量检索（见 D2）。
- 风险：一旦酒店政策接入检索池，如果不加过滤，A 酒店客人的问题可能检索到 B 酒店的条款——这是加酒店政策前必须先堵上的口子，不是锦上添花。
- 待团队评估的方向（不是 Zachary 的选择，仅供讨论参考）：
  - 检索入参带当前订单的 `hotel_id`；`RagDocumentChunk`（或新建的政策 chunk 表）加 `hotel_id` 列，平台通用文档记 `null`。
  - 查询逻辑类似 `WHERE hotel_id = :bookingHotelId OR hotel_id IS NULL`，酒店专属命中优先于通用文档。
- **待开发团队反馈**：一次检索取几条（top-k）、酒店专属和通用文档同时命中时的优先级/加权规则、现有 `score < 0.5` 阈值在混入酒店政策后是否还适用。**优先级规则如果涉及"客人该看到哪家酒店的哪条政策"这类业务判断，建议团队拿不准时把方案带回来给 Zachary 过一遍，而不是纯技术自行决定。**

### D6. 配置与分层 ✅ 已决策（2026-09-08，Zachary）

**结论：backend 一般配置暂不强制迁 SSM，留到最后一轮联调测试时再确认；但"关键接口调用的 key"（凭证/密钥类）不在此列，仍按 CLAUDE.md 第二条铁律走 Secrets Manager 处理。**

- 现状（2026-09-08 核对代码）：backend 目前有 **15 处**裸 `Environment.GetEnvironmentVariable`（`Program.cs`、`GeminiClient.cs`、`OpsService.cs`、`AuthController.cs`、`HandoffIngestJob.cs`、`IngestKeyAuthFilter.cs`、`SmtpEmailService.cs`、`S3PolicyDocumentStorage.cs`、`CaseEmailLinks.cs` 等），backend 里**没有任何 SSM 客户端调用**（唯一一处"SSM"字样只是 `GeminiClient.cs` 里的注释）。区域也硬编码 `Amazon.RegionEndpoint.APSoutheast2`（`GeminiClient.cs:18`）。
- **Zachary 的澄清**：CLAUDE.md「AWS 五条铁律」第 1 条（资源名/模型 ID 从 SSM 读）对 backend 而言，柔性处理——桶名、模型 ID、超时时长这类**一般配置**暂时留在 env 也可以，不是现在的优先级，留到最后一轮联调测试时再统一确认要不要收进 SSM。真正在意的是第 2 条铁律——**关键接口调用的 key**（凭证/密钥）该走 Secrets Manager，不能只是 env 变量。对照现有 15 处，落在这条线上的是 `GEMINI_API_KEY`（`GeminiClient.cs`）、`INGEST_SHARED_KEY`（`IngestKeyAuthFilter.cs`）、`SMTP_USER`/`SMTP_PASS`（`SmtpEmailService.cs`）——这几个是凭证，其余（`FRONTEND_ORIGIN`、`SESSION_IDLE_TIMEOUT_MINUTES`、`S3_POLICY_BUCKET`、`BEDROCK_MODEL_ID` 等）是一般配置，不强制现在动。
- 对本次 RAG 改造的影响：新增的桶名、embedding 模型 ID、向量维度这类配置项，可以先按 env 处理，不必现在就接 SSM；但如果这次改造会新增任何调用第三方接口的 key/凭证，那个要按 Secrets Manager 处理，不能图省事塞进 env。

**开发团队负责的部分**：

- 现有 4 个凭证类 env 变量（`GEMINI_API_KEY`/`INGEST_SHARED_KEY`/`SMTP_USER`/`SMTP_PASS`）要不要现在就迁 Secrets Manager，还是也一并留到最后一轮联调测试，由团队评估排期后反馈。
- 检索/相似度这类业务逻辑，若 backend 未来也做类似 Python 侧的三层分层，应该落在哪一层（对应「core」的等价层），是团队内部的架构落地问题。

---

## 5. 建议实施顺序

1. **先合并 `Test` → `Dev-Zachary`**，拿到 PR #108 的 S3 归档能力作为基线。
2. **D1 + D4 定调**（pgvector? Bedrock embedding?）——这两个决定数据模型和迁移脚本，必须最先定。
3. 加「无结构文本」分块器（D3）。
4. `HotelRefundPolicy` 上传链路接分块 + embedding + 向量入库（D2 先按同步做）。
5. `FindRelevantSnippetAsync` 改带 `hotel_id` 过滤 + top-k（D5）。
6. 存量：现有 13 个通用 chunk 按新维度/新库重算。
7. **然后**才做 ragas 评测（见 §6）。

---

## 6. 对 RAG 评测的影响

- **改造前**：评测只能覆盖现有 13 个平台通用 chunk，测的是「平台通用政策 + 使用说明 + FAQ」的检索命中率。这个可以**现在就做**，与本提案并行，作为改造前基线。
- **改造后**：golden 集要扩展到「问题 → 该命中的酒店专属 chunk」，并验证 hotel_id 过滤没串味、酒店政策与通用文档的优先级符合预期。
- 评测指标建议不变：ID-based / non-LLM 的 context precision & recall（不需要 LLM 判官），另可加 Faithfulness（需 Bedrock 判官）测生成是否忠于检索原文。
- golden 集格式（稳定定位符，不写运行时 UUID）：

```json
{
  "query": "台风把我航班取消了，这家酒店能退全款吗？",
  "hotel_id": "<booking 的 hotel_id，或 null 表示应命中通用文档>",
  "relevant_chunks": [
    { "doc": "取消与改订政策", "heading": "不可抗力情形下的退款" }
  ],
  "expect_retrieval": "hit",
  "note": "不可抗力全额退"
}
```

---

## 7. 待 Zachary 回填

- [x] D1：迁 pgvector（已实现，PR #126，`vector(1024)` + HNSW）
- [ ] D2：同步/异步——已转开发团队讨论，待反馈
- [ ] D3：分块策略——已转开发团队讨论，待反馈
- [x] D4：embedding 供应商维持 Gemini，不切 Bedrock（2026-09-08 拍板）
- [ ] D5：hotel_id 过滤——已转开发团队讨论，优先级规则待团队回流确认
- [x] D6：backend 一般配置暂留 env、留到最后一轮联调测试再定；凭证类 key 仍需走 Secrets Manager（2026-09-08 拍板）
- [ ] 存量向量迁移脚本：D1 已用截断方案完成，待确认截断参数是否为有意选择（问 Dev-Yang）
