# RAG 检索评测 · golden 集

## 这是什么

`rag_golden.jsonl` 是评测 **RAG 检索层命中率** 的标注数据（改造前基线版）。
每行一条：一个用户问法 + 该命中哪个知识库切片。用来跑 ragas 的 context precision / recall
（ID-based / non-LLM，不需要 LLM 判官）。

**范围**：只覆盖当前向量检索的语料——`backend/SeedData/rag/` 下 3 个 markdown 对应的
文档（其中"取消与改订政策"当前默认版本是 v2，比种子文件多一个小标题，见下方「已知问题」），
共 14 个内容切片。酒店专属退改政策（`HotelRefundPolicy`）**不在这一版**，因为它现在根本不走
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

14 个内容切片，每个 heading 2~3 条问法（1 中 2 英或 2 中 1 英），共 41 条 `hit` + 8 条 `miss` = 49 条。
（2026-09-08 核对：原文档写的"13 个切片/39 条 hit/47 条总数"本身就有算术错误——`faq-refundtime`
只有 2 条不是 3 条，真实应为 38+8=46；后来又补了 `policy-stormshield-*` 3 条，见下方「⚠️ 已知问题」。）

| doc | heading | 条目 |
|---|---|---|
| 使用说明 | Viewing your disruption notifications | guide-notif-01/02/03 |
| 使用说明 | Contacting a coordinator | guide-coord-01/02/03 |
| 使用说明 | Editing your profile | guide-profile-01/02/03 |
| 使用说明 | Language settings | guide-lang-01/02/03 |
| 取消与改订政策 | Free cancellation window | policy-free-01/02/03 |
| 取消与改订政策 | Deferral due to a disruption | policy-defer-01/02/03 |
| 取消与改订政策 | **Storm Shield Priority Rebooking**（2026-09-08 新补） | policy-stormshield-01/02/03 |
| 取消与改订政策 | Alternative-stay price difference | policy-altprice-01/02/03 |
| 取消与改订政策 | Refund policy | policy-refund-01/02/03 |
| 取消与改订政策 | No-show terms | policy-noshow-01/02/03 |
| 常见问题 | My booking has been affected by a disruption — what happens next? | faq-affected-01/02/03 |
| 常见问题 | What options can I choose from? | faq-options-01/02/03 |
| 常见问题 | How long does a refund take? | faq-refundtime-01/02 |
| 常见问题 | Can I book a new hotel directly on this platform? | faq-newbooking-01/02/03 |
| —（负样本） | — | neg-* ×8 |

## ✅ 已核实（2026-09-08，连共享 dev 库实测）

1. **切片确实会产生垃圾 chunk，三份文档行为一致**：`Content.Split("\n## ")` 后，
   index 0 永远是只有一级标题的垃圾切片（如 `# User Guide`），真正内容从 index 1
   开始。映射脚本按 `{doc, heading}` 查到真实 chunk 后，**不要**自己按 heading 在
   表格里的顺序位置去猜 index——必须实查当前数据库里该 chunk 的真实 `chunk_index`，
   原因见下面第 2 条。
2. **种子内容天然一致，不用人工核对**：`SeedRunner.cs` 是直接
   `File.ReadAllText(seedDir/rag/*.md)` 灌入 `Content`，不是维护两份拷贝，天生同步。
3. **`acceptable_chunks` 的两处争议判断，复核后认可**：`neg-account-01`（找回密码，
   Profile 页只讲登录后改密码不讲找回）判 miss 合理；`policy-refund-02`（退款是否
   自动到账）判 hit 合理，原文明确写"never issued automatically"。
4. **mi（毛利语）确实 0 覆盖**：`使用说明.md` 提到系统支持 mi，但全部 49 条问法一条 mi
   都没有。是否需要补，待你们评测范围决定。

## 🔴 已知问题（2026-09-08 发现，比原来 4 条更关键）

1. **`doc` 字段和数据库实际 `RagDocument.Name`对不上**：本文件用中文文件名
   （`使用说明`/`取消与改订政策`/`常见问题`）当 `doc` 标识，但
   `backend/SeedData/rag_documents.json` 里实际入库的 `Name` 是英文
   （`User Guide`/`Cancellation & Rebooking Policy`/`Frequently Asked Questions`）。
   映射脚本如果直接 `WHERE RagDocument.Name = golden.doc` 会一条都查不到。写脚本时
   要么在脚本里维护一张"中文 doc → 英文 Name"映射表，要么把本文件的 `doc` 字段
   统一换成英文 Name（后者更省事，建议这么做，尚未执行）。

2. **共享 dev 库的语料不是静态的，本次已核实一次真实漂移并已修正**：连库查询发现
   `Cancellation & Rebooking Policy` 现在有 **2 个版本**——v1（`is_default_version=false`，
   6 chunks）已被替换，v2（`is_default_version=true`，7 chunks）才是现在真正被检索
   的版本，比 golden 集设计时多了一个小标题 **`Storm Shield Priority Rebooking`**
   （插在 `Deferral due to a disruption` 和 `Alternative-stay price difference` 之间，
   导致后三个 heading 的真实 chunk_index 整体 +1）。已处理：
   - `rag_golden.jsonl` 补了 `policy-stormshield-01/02/03` 三条覆盖新标题；
   - 其余引用该文档 heading 的条目**不需要改**——本文件用 heading 文本定位，不是硬编码
     index，只要映射脚本按 heading 文本实时查询当前 chunk_index（而不是按文档里
     heading 出现顺序自己数），就不受这次位移影响。
   - **这件事会不会再发生是开放性风险**：只要有人再上传一个新版本文档并被设为默认版本，
     语料就会再变一次，golden 集又可能过时。跑评测前建议先查一次
     `SELECT name, version, is_default_version, updated_at FROM rag_documents` 确认
     语料状态，而不是假设本文件的覆盖表永远准确。

## 下一步（评测脚本，待做）

1. backend 加只读检索端点：输入 query，返回 top-k `{chunk_id, doc_name, chunk_index, score}`
   （去掉现在的 top-1 限制和 0.5 阈值，评测要看完整排名）。
2. 映射脚本：`{doc, heading}` → 真实 chunk id。
3. Python：读本文件 → 调端点 → 组 ragas `EvaluationDataset` → `IDBasedContextPrecision`
   + `IDBasedContextRecall` → 输出 CSV。
4. 负样本单独统计：`miss` 条目里最高分是否真的 < 0.5。
