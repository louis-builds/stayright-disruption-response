"""A 线：ID-based 检索层评测（IDBasedContextPrecision / IDBasedContextRecall）。

跑法（假设已经 `aws ssm start-session ... AWS-StartPortForwardingSession` 开了到
共享 dev 库 15432 端口的隧道，backend 跑在 https://d2y6g16anevc6h.cloudfront.net）：

    export EVAL_DB_PASSWORD=$(aws secretsmanager get-secret-value \
        --secret-id stayright/dev/db/password --region ap-southeast-2 \
        --query SecretString --output text)
    export EVAL_API_PASSWORD='Password123!'
    python run_retrieval_eval.py

用之前必须确认过 eval/README.md 里「已知问题」这一节——尤其是 DOC_NAME_MAP，
数据库里 RagDocument.Name 是英文，golden 集的 doc 字段是中文，这里要对齐。

不需要任何 LLM key：IDBasedContextPrecision/Recall 是纯 ID 集合运算，不调用 LLM。
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import psycopg
import requests
from ragas import EvaluationDataset, SingleTurnSample, evaluate
from ragas.metrics import IDBasedContextPrecision, IDBasedContextRecall

API_BASE = os.environ.get("EVAL_API_BASE", "https://d2y6g16anevc6h.cloudfront.net")
API_IDENTIFIER = os.environ.get("EVAL_API_IDENTIFIER", "coord1@example.com")
API_PASSWORD = os.environ["EVAL_API_PASSWORD"]

DB_HOST = os.environ.get("EVAL_DB_HOST", "localhost")
DB_PORT = int(os.environ.get("EVAL_DB_PORT", "15432"))
DB_USER = os.environ.get("EVAL_DB_USER", "app")
DB_PASSWORD = os.environ["EVAL_DB_PASSWORD"]
DB_NAME = os.environ.get("EVAL_DB_NAME", "stayright")

TOP_K = int(os.environ.get("EVAL_TOP_K", "1"))
# 2026-09-08：topK 定成 1，因为生产环境 ChatService.FindRelevantSnippetAsync
# 实际就是 top-1 + 0.5 阈值——评测要对齐生产环境真实检索深度，不是随便选个数字，
# 见 eval/README.md「topK 参数选择依据」一节。
MISS_SCORE_THRESHOLD = float(os.environ.get("EVAL_MISS_THRESHOLD", "0.5"))

GOLDEN_PATH = Path(__file__).parent / "rag_golden.jsonl"

# golden 集用中文文件名当 doc 标识，数据库 RagDocument.Name 是英文。
# 2026-09-29 起平台没有默认退款政策，不再映射「取消与改订政策」。
DOC_NAME_MAP = {
    "使用说明": "User Guide",
    "常见问题": "Frequently Asked Questions",
}


@dataclass
class ChunkRef:
    doc_name_en: str
    heading: str
    chunk_id: str


def load_golden(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def build_heading_index(conn: psycopg.Connection) -> dict[tuple[str, str], str]:
    """({英文 doc_name}, {heading 首行文本}) -> chunk_id，只看当前 default version。

    垃圾 chunk（index 0 的纯标题行，如 `# User Guide`）天然不会被匹配到——
    它的首行是 `# ...`，不会等于任何 golden 集里的 heading 文本。
    """
    index: dict[tuple[str, str], str] = {}
    with conn.cursor() as cur:
        cur.execute("""
            SELECT rd.name, c.id, c.content
            FROM rag_document_chunks c
            JOIN rag_documents rd ON rd.id = c.rag_document_id
            WHERE rd.is_default_version = true
              AND rd.hotel_id IS NULL
              AND COALESCE(rd.source_type, '') <> 'hotel-policy'
        """)
        for doc_name, chunk_id, content in cur.fetchall():
            heading = content.split("\n", 1)[0].strip()
            index[(doc_name, heading)] = str(chunk_id)
    return index


def resolve_ids(refs: list[dict], heading_index: dict[tuple[str, str], str]) -> list[str]:
    ids = []
    for ref in refs:
        doc_en = DOC_NAME_MAP.get(ref["doc"], ref["doc"])
        chunk_id = heading_index.get((doc_en, ref["heading"]))
        if chunk_id is None:
            print(f"  ⚠️  找不到 chunk：doc={ref['doc']!r}({doc_en!r}) heading={ref['heading']!r}", file=sys.stderr)
            continue
        ids.append(chunk_id)
    return ids


def login(session: requests.Session) -> None:
    resp = session.post(
        f"{API_BASE}/api/auth/login",
        json={"identifier": API_IDENTIFIER, "password": API_PASSWORD},
        timeout=30,
    )
    resp.raise_for_status()
    if resp.json().get("code") != 0:
        raise RuntimeError(f"login failed: {resp.text}")


def search(session: requests.Session, query: str, top_k: int) -> list[dict]:
    resp = session.get(
        f"{API_BASE}/api/coordinator/knowledge-base/search",
        params={"q": query, "topK": top_k},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["data"]


def main() -> None:
    golden = load_golden(GOLDEN_PATH)
    hit_items = [g for g in golden if g["expect_retrieval"] == "hit"]
    miss_items = [g for g in golden if g["expect_retrieval"] == "miss"]
    print(f"golden 集：{len(golden)} 条（hit={len(hit_items)}, miss={len(miss_items)}）")

    print(f"连数据库 {DB_HOST}:{DB_PORT}/{DB_NAME} 建 heading 索引...")
    with psycopg.connect(host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD, dbname=DB_NAME) as conn:
        heading_index = build_heading_index(conn)
    print(f"  索引到 {len(heading_index)} 个当前默认版本的 chunk")

    session = requests.Session()
    print(f"登录 {API_BASE} ...")
    login(session)

    # ---- hit 条目：IDBasedContextPrecision / IDBasedContextRecall ----
    samples = []
    included_ids = []  # 跟 samples 严格一一对应，用来给最终 CSV 对齐 golden id
    skipped = 0
    for item in hit_items:
        retrieved = search(session, item["query"], TOP_K)
        retrieved_ids = [r["chunkId"] for r in retrieved]

        reference_ids = resolve_ids(item["relevant_chunks"], heading_index)
        # acceptable_chunks 计入 recall 的参考答案（README 里写的policy），
        # 不计入会让"检索到次优命中"被误判成漏检。
        reference_ids += resolve_ids(item.get("acceptable_chunks", []), heading_index)
        if not reference_ids:
            print(f"  ⚠️  跳过 {item['id']}：一个参考 chunk 都没解析出来", file=sys.stderr)
            skipped += 1
            continue

        samples.append(SingleTurnSample(
            user_input=item["query"],
            retrieved_context_ids=retrieved_ids,
            reference_context_ids=reference_ids,
        ))
        included_ids.append(item["id"])

    print(f"\n组好 {len(samples)} 条样本（跳过 {skipped} 条无法解析参考答案的），开始跑 ragas...")
    dataset = EvaluationDataset(samples=samples)
    result = evaluate(dataset, metrics=[IDBasedContextPrecision(), IDBasedContextRecall()])
    print("\n=== 检索层结果（hit 条目）===")
    print(result)

    df = result.to_pandas()
    df.insert(0, "id", included_ids)
    out_csv = Path(__file__).parent / "retrieval_eval_results.csv"
    df.to_csv(out_csv, index=False)
    print(f"逐条结果已存 {out_csv}")

    # ---- miss 条目：单独统计阈值，不进 ragas（这两个指标不适用于"应该查不到"的情况）----
    print(f"\n=== 负样本（miss，{len(miss_items)} 条）阈值检查（< {MISS_SCORE_THRESHOLD} 才算通过）===")
    miss_pass = 0
    for item in miss_items:
        top1 = search(session, item["query"], 1)
        score = top1[0]["score"] if top1 else float("inf")
        passed = score >= MISS_SCORE_THRESHOLD  # cosine distance：越大越不像，>= 阈值才算"确实没查到"
        miss_pass += passed
        mark = "✅" if passed else "❌"
        print(f"  {mark} {item['id']}: distance={score:.3f}  ({item['query'][:40]})")
    print(f"\n负样本通过 {miss_pass}/{len(miss_items)}")


if __name__ == "__main__":
    main()
