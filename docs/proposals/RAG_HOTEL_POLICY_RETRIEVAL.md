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

### D1. 向量存储：迁 pgvector，还是继续应用层暴力算？

- 现状：`real[]` 列 + C# 遍历余弦。语料 ~13 chunk 时无所谓。
- 加酒店政策后：N 家酒店 × 多版本 × 每份多 chunk，可能到几百~几千 chunk。每次聊天请求全表遍历 + 逐个余弦，明显是「语料规模真的大了」。
- `CLAUDE.md` / `DATABASE_ACCESS.md` 已经规定：向量列名 `embedding`、必须建 **HNSW** 索引 —— 也就是本来就该用 pgvector。
- **建议**：这次一起迁 pgvector。改动范围：加扩展、`RagDocumentChunk.Embedding` 换 `vector(N)` 类型、检索改成 SQL `ORDER BY embedding <=> :q LIMIT k`、加 HNSW 索引、EF Core 接 `Pgvector.EntityFrameworkCore`。
- **反方案**：如果 demo 期语料实际不大（比如只有 5~10 家酒店），可以接受再撑一阵，但要在代码注释和本文件里写明「已知技术债，触发条件：chunk 总数 > X」。

### D2. embedding 的时机：同步 vs 异步

- 现状：`UploadDocumentAsync` 在请求线程里逐 chunk 调 Gemini，上传接口**同步返回**抽取结果 + golden test 结果。
- 酒店政策上传接口 `UploadRefundPolicyFileAsync` 目前也是同步返回 `ExtractedRefundRulesDto`。
- 一份长 PDF 可能切出几十个 chunk，几十次串行 embedding API 调用 → 上传接口卡几十秒甚至超时。
- **选项 A（同步）**：简单，与现有 KB 上传一致；靠「文件小 + chunk 少」兜底，加并发限流。
- **选项 B（异步）**：上传只落文本 + S3，embedding 交给后台 worker（EC2 modular monolith 里已有 worker 外壳的位置，或走一条 SQS 消息）。更符合项目「事件驱动 + 幂等消费」的既定模式，但要处理「政策已上线但向量还没好」的中间态（检索先回退通用文档）。
- **建议**：政策文档量小、上传非高频，**先做同步 + 限流**；若压测发现超时再切异步。把判断写进本文件。

### D3. 分块策略：`Split("\n## ")` 不够用

- 现状切片假设输入是带 `## ` 标题的 markdown。
- `PolicyDocumentExtractor.ExtractPdf` 产出的是 `string.Join("\n", 每页文字)`——**没有 `## `**。直接套现有逻辑 → 整份 PDF 变成 1 个巨型 chunk → embedding 稀释、检索命中率差。
- 我们提供的 4 个样例政策每条是单段纯文本，也没有标题，同样问题。
- **建议**：为「无结构文本」加一个 fallback 分块器：按段落 / 固定 token 窗口（如 300~500 token，重叠 50）切。markdown 仍走 `## ` 优先。
- 需要定：目标 chunk 大小、是否重叠、embedding 模型的输入上限（`gemini-embedding-001` 约 2048 token）。

### D4. embedding 供应商：Gemini vs Bedrock

- 现状 LLM 生成：Gemini 首选、Bedrock 降级；embedding：**只有 Gemini**（`gemini-embedding-001`），无降级。
- `CLAUDE.md` 技术栈是「AWS Bedrock + boto3 唯一」。Gemini embedding 把知识库文本发到 Google——如果政策文档算敏感数据，可能触碰 NZ 数据驻留要求（与「禁止 `global.` 前缀」同一顾虑）。
- **决策点**：酒店政策 embedding 是否必须走 Bedrock（Titan Embeddings v2，`ap-southeast-2`）？如果是，`GeminiClient.EmbedAsync` 要加 Bedrock 实现，且**换供应商 = 向量维度变 = 存量向量全部重算**，迁移脚本要一起设计。
- **建议**：借这次改造统一到 Bedrock Titan Embeddings，避免政策文本出境；维度锁定后写进 SSM。

### D5. 检索范围：按 hotel_id 过滤

- 加酒店政策后，不能把所有酒店的政策混一个池子搜——A 酒店的客人不该检索到 B 酒店的条款。
- 检索入参要带当前订单的 `hotel_id`；`RagDocumentChunk`（或新的政策 chunk 表）要有 `hotel_id` 列（平台通用文档为 null）。
- 检索逻辑：`WHERE hotel_id = :bookingHotelId OR hotel_id IS NULL`，酒店专属命中优先。
- 需要定：一次检索取几条（top-k）、酒店政策与通用文档的优先级/加权规则、`< 0.5` 阈值是否仍适用。

### D6. 配置与分层

- 新增的桶名、embedding 模型 ID、维度，按 `CLAUDE.md` 铁律应从 SSM `cfg()` 读，不是 env。
- backend 目前没有 SSM 读取层。要么这次补一个最小 `cfg()`（对齐 Python 侧的 `/stayright/{stage}/{key}` 约定），要么明确 backend 暂用 env、后续统一。
- 检索/相似度属于业务逻辑，若将来 backend 也分层，应落在「core」等价层，不与 S3/pgvector 客户端混在一起。

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

- [ ] D1：迁 pgvector，还是记债？触发阈值？
- [ ] D2：embedding 同步还是异步？
- [ ] D3：目标 chunk 大小 / 重叠 / 分块器归属
- [ ] D4：embedding 供应商锁 Bedrock Titan 还是留 Gemini？维度？
- [ ] D5：top-k？酒店 vs 通用优先级？阈值？
- [ ] D6：backend 补 SSM `cfg()` 还是暂用 env？
- [ ] 存量向量迁移脚本谁写、什么时候跑
