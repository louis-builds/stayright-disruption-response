# RAG 检索评测 · golden 集

## 这是什么

`rag_golden.jsonl` 是评测 **RAG 检索层命中率** 的标注数据（改造前基线版）。
每行一条：一个用户问法 + 该命中哪个知识库切片。用来跑 ragas 的 context precision / recall
（ID-based / non-LLM，不需要 LLM 判官）。

**范围**：只覆盖当前向量检索的语料——`backend/SeedData/rag/` 下 3 个 markdown 的
13 个内容切片。酒店专属退改政策（`HotelRefundPolicy`）**不在这一版**，因为它现在根本不走
向量检索，详见 `docs/proposals/RAG_HOTEL_POLICY_RETRIEVAL.md`。

## 字段

| 字段 | 说明 |
|---|---|
| `id` | 稳定标识，跑评测报告时对齐用 |
| `query` | 用户问法（中英混，贴近真实客人） |
| `relevant_chunks` | 该命中的切片，用 `{doc, heading}` 稳定定位符，**不写运行时 UUID** |
| `acceptable_chunks` | 也算对的次优切片（语义重叠时）。评 recall 时计入，评严格 precision 时人工看 |
| `expect_retrieval` | `hit` = 应检索到内容；`miss` = 知识库无相关内容，最高相似度应 < 0.5 阈值被丢弃 |
| `note` | 标注理由，人工复核时看 |

`doc` 取值：`使用说明` / `取消与改订政策` / `常见问题`（对应 md 文件名去扩展名）。
`heading` 是该 md 里的二级标题原文。

## 覆盖情况

13 个内容切片，每个 3 条问法（1 中 2 英或 2 中 1 英），共 39 条 `hit` + 8 条 `miss` = 47 条。

| doc | heading | 条目 |
|---|---|---|
| 使用说明 | Viewing your disruption notifications | guide-notif-01/02/03 |
| 使用说明 | Contacting a coordinator | guide-coord-01/02/03 |
| 使用说明 | Editing your profile | guide-profile-01/02/03 |
| 使用说明 | Language settings | guide-lang-01/02/03 |
| 取消与改订政策 | Free cancellation window | policy-free-01/02/03 |
| 取消与改订政策 | Deferral due to a disruption | policy-defer-01/02/03 |
| 取消与改订政策 | Alternative-stay price difference | policy-altprice-01/02/03 |
| 取消与改订政策 | Refund policy | policy-refund-01/02/03 |
| 取消与改订政策 | No-show terms | policy-noshow-01/02/03 |
| 常见问题 | My booking has been affected by a disruption — what happens next? | faq-affected-01/02/03 |
| 常见问题 | What options can I choose from? | faq-options-01/02/03 |
| 常见问题 | How long does a refund take? | faq-refundtime-01/02 |
| 常见问题 | Can I book a new hotel directly on this platform? | faq-newbooking-01/02/03 |
| —（负样本） | — | neg-* ×8 |

## ⚠️ 用之前必须人工做的事

1. **核对切片是否真的这样切**：`KnowledgeBaseService.UploadDocumentAsync` 是
   `Content.Split("\n## ")`。每个 md 的第一段是 `# 一级标题`，会被切成 index 0 的
   「垃圾切片」（只有标题行）。跑评测时把 `{doc, heading}` 映射成真实 chunk id 的脚本要处理这个。
2. **确认种子来源**：检查 `SeedData/rag_documents.json` / `SeedRunner` 里入库的 `Content`
   跟 `SeedData/rag/*.md` 是否一字不差；不一致以库里的为准。
3. **逐条复核 query**：我编的问法里，客人未必都那样说；`acceptable_chunks` 的判断
   （尤其 `neg-account-01` 找回密码、`policy-refund-02` 退款时长）需要你拍板算不算命中。
4. **补齐语言覆盖**：目前 mi（毛利语）一条没有，若评测要覆盖 mi 需另补。

## 下一步（评测脚本，待做）

1. backend 加只读检索端点：输入 query，返回 top-k `{chunk_id, doc_name, chunk_index, score}`
   （去掉现在的 top-1 限制和 0.5 阈值，评测要看完整排名）。
2. 映射脚本：`{doc, heading}` → 真实 chunk id。
3. Python：读本文件 → 调端点 → 组 ragas `EvaluationDataset` → `IDBasedContextPrecision`
   + `IDBasedContextRecall` → 输出 CSV。
4. 负样本单独统计：`miss` 条目里最高分是否真的 < 0.5。
