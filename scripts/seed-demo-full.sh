#!/usr/bin/env bash
# 完整链路演示脚本：从 Lambda 真实触发开始，走完全程。
#
#   ./scripts/seed-demo-full.sh
#
# 与 seed-demo-case.sh（直注模式）的区别：
#   直注模式：脚本 POST ingest，扮演 Lambda → 快、100% 成功，但 CloudWatch 无 Lambda 日志。
#   完整模式：真实 `aws lambda invoke` 触发探测 → CloudWatch 出日志 → Open-Meteo 真实天气
#             → Auckland 命中风险窗口即建案，否则回退直注 Auckland 扰动兜底。
#
# 固定三个演示账号（密码统一 Password123!）：
#   Guest        yangdongqing214@gmail.com   （昵称 Test Guest1）
#   Hotel        donwhotel@gmail.com         （DHW Hotel Auckland 前台）
#   Coordinator  coord1@example.com
#
# Guest 的预订全部在 DHW Hotel Auckland，整条链路只围绕 Auckland：
# Lambda 真实触发时只关心 AKL 是否命中；未命中就回退直注 Auckland 扰动。
#
# 前置：
#   1. 演示机 AWS 凭证可用（lambda invoke + ssm send-command + logs）
#   2. scripts/.env.demo 里有 INGEST_KEY（回退用）
#
# 它做六件事：
#   1. 经 EC2 SSM 给 Guest 预插 1 条 Auckland 宽日期桥接预订（confirmation_no
#      冲突即更新日期）——日期跟随运行日（明天入住住 5 晚），保证落在扰动窗口内
#   2. invoke Lambda，抓取 CloudWatch 最新日志行打印（演示的"探测"节拍）
#   3. 对比 invoke 前后的扰动列表，找出本次新增的扰动
#   4. 在新增扰动里找能匹配桥接预订的候选 → 命中则 notify 建案；未命中回退直注 Auckland 扰动
#   5. regenerate + push 方案
#   6. 三端核验打印
set -euo pipefail

BASE="${BASE:?Set BASE (no cross-account default, e.g. https://<your-cloudfront-domain>)}"
REGION_AWS="${AWS_REGION:-ap-southeast-2}"
EC2_ID="${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID (no cross-account default)}"
FN="${LAMBDA_FN:?Set LAMBDA_FN (no cross-account default)}"
COORD_EMAIL="${COORD_EMAIL:-coord1@example.com}"
GUEST_EMAIL="${GUEST_EMAIL:-yangdongqing214@gmail.com}"
GUEST_NICK="${GUEST_NAME:-Test Guest1}"
HOTEL_EMAIL="${HOTEL_EMAIL:-donwhotel@gmail.com}"
BRIDGE_HOTEL="${BRIDGE_HOTEL:-DHW Hotel Auckland}"
DEMO_PASS="${DEMO_PASS:-Password123!}"
CLOSE_REASON="人工决议结案"

cd "$(dirname "$0")"
if [ -f .env.demo ]; then source .env.demo; fi
INGEST_KEY="${INGEST_KEY:-}"

JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
pyexec() { python3 -c "$@"; }
api() { curl -s -b "$JAR" -c "$JAR" -X "$1" "${BASE}$2" ${3:+-H "Content-Type: application/json" -d "$3"}; }
urlenc() { printf '%s' "$1" | pyexec "import sys,urllib.parse; print(urllib.parse.quote(sys.stdin.read()))"; }

# ---------- 0. 协调员登录 + 扰动快照 ----------
say "0. 登录协调员并记录扰动快照"
LOGIN=$(curl -s -c "$JAR" -X POST "${BASE}/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"identifier\":\"${COORD_EMAIL}\",\"password\":\"${DEMO_PASS}\"}")
pyexec "import json,sys; d=json.loads('''${LOGIN}'''); sys.exit(0 if d.get('code')==0 else print(d) or 1)" || { echo "登录失败"; exit 1; }
OPEN=$(api GET "/api/coordinator/search?q=$(urlenc "$GUEST_NICK")")
printf '%s' "$OPEN" | pyexec "
import json,sys
for c in json.load(sys.stdin).get('data') or []:
    if c.get('guestNickname')=='${GUEST_NICK}' and c.get('status')!='closed':
        print(c['caseId'])" | while IFS= read -r cid; do
  [ -z "$cid" ] && continue
  api POST "/api/coordinator/cases/${cid}/close" "{\"closeReason\":\"${CLOSE_REASON}\",\"resultSummary\":\"Cleared by demo seed script.\"}" >/dev/null
  echo "  已关闭遗留案件: ${cid}"
done
BEFORE=$(api GET "/api/coordinator/disruptions" | pyexec "import json,sys; print(json.dumps(sorted(i['id'] for i in json.load(sys.stdin)['data'])))")
echo "OK（当前扰动 $(printf '%s' "$BEFORE" | pyexec "import json,sys; print(len(json.load(sys.stdin)))") 条）"

# ---------- 1. 预插桥接预订（日期跟随运行日：明天入住住 5 晚，幂等更新） ----------
say "1. 给 Guest 预插 1 条 Auckland 桥接预订（经 EC2 SSM）"
dplus() { date -v+"$1"d +%F 2>/dev/null || date -d "+$1 days" +%F; }
CI=$(dplus 1); CO=$(dplus 6)
SQL=$(cat <<'EOSQL'
INSERT INTO bookings (id, confirmation_no, guest_user_id, hotel_id, room_type_id,
                      check_in, check_out, guests_count, total_amount, currency, status, created_at, updated_at)
SELECT gen_random_uuid(), 'CONF-DEMO-AKL', u.id, h.id,
       (SELECT id FROM room_types WHERE hotel_id = h.id LIMIT 1),
       :'cin'::date, :'cout'::date, 2, 432.00, 'NZD', 'confirmed', now(), now()
FROM users u
JOIN hotels h ON h.name = :'hotel'
WHERE u.email = :'guest'
ON CONFLICT (confirmation_no) DO UPDATE
  SET check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out, updated_at = now();
SELECT confirmation_no, check_in, check_out FROM bookings WHERE confirmation_no = 'CONF-DEMO-AKL';
EOSQL
)
B64=$(printf '%s' "$SQL" | base64 | tr -d '\n')
REMOTE_CMD="echo ${B64} | base64 -d > /tmp/demo_seed.sql && sudo docker exec -i pg psql -U app -d stayright -v ON_ERROR_STOP=1 -v cin=${CI} -v cout=${CO} -v guest=${GUEST_EMAIL} -v hotel=\\\"${BRIDGE_HOTEL}\\\" < /tmp/demo_seed.sql && rm /tmp/demo_seed.sql"
CMD_ID=$(aws ssm send-command --region "$REGION_AWS" --instance-ids "$EC2_ID" \
  --document-name AWS-RunShellScript --comment "demo seed: bridge booking" \
  --parameters "commands=[\"${REMOTE_CMD}\"]" \
  --output text --query 'Command.CommandId')
for i in $(seq 1 20); do
  ST=$(aws ssm get-command-invocation --region "$REGION_AWS" --command-id "$CMD_ID" --instance-id "$EC2_ID" --query Status --output text 2>/dev/null) && [ "$ST" != "InProgress" ] && [ "$ST" != "Pending" ] && break
  sleep 2
done
if [ "$ST" != "Success" ]; then
  aws ssm get-command-invocation --region "$REGION_AWS" --command-id "$CMD_ID" --instance-id "$EC2_ID" --query StandardErrorContent --output text
  echo "❌ 预订注入失败"; exit 1
fi
aws ssm get-command-invocation --region "$REGION_AWS" --command-id "$CMD_ID" --instance-id "$EC2_ID" --query StandardOutputContent --output text | grep -E "CONF-DEMO|row" || true

# ---------- 2. 真实触发 Lambda ----------
say "2. 手工触发 Lambda（真实 Open-Meteo 探测）"
OUT=$(mktemp)
aws lambda invoke --function-name "$FN" --region "$REGION_AWS" --cli-binary-format raw-in-base64-out "$OUT" >/dev/null
RESULT=$(cat "$OUT"); rm -f "$OUT"
echo "  Lambda 返回: ${RESULT}"
LOGLINE=""
for i in 1 2 3 4; do
  sleep 3
  STREAM=$(aws logs describe-log-streams --region "$REGION_AWS" --log-group-name "/aws/lambda/$FN" \
    --order-by LastEventTime --descending --limit 1 --query 'logStreams[0].logStreamName' --output text)
  LOGLINE=$(aws logs get-log-events --region "$REGION_AWS" --log-group-name "/aws/lambda/$FN" \
    --log-stream-name "$STREAM" --limit 8 --query 'events[].message' --output text \
    | grep -o '{"evt".*' | tail -1 || true)
  [ -n "$LOGLINE" ] && break
done
echo "  ☁️  CloudWatch 日志行: ${LOGLINE:-（未抓到，去 Live Tail 看也会有）}"

# ---------- 3. 找本次新增的扰动 ----------
say "3. 找出本次探测新增的扰动"
AFTER=$(api GET "/api/coordinator/disruptions" | pyexec "import json,sys; print(json.dumps(sorted(i['id'] for i in json.load(sys.stdin)['data'])))")
NEW_IDS=$(printf '%s\n%s' "$BEFORE" "$AFTER" | pyexec "
import json,sys
lines=sys.stdin.read().splitlines()
b=set(json.loads(lines[0])); a=set(json.loads(lines[1]))
print('\n'.join(sorted(a-b)))")
[ -z "$NEW_IDS" ] && echo "  （本次零新增）" || printf '  %s\n' "$NEW_IDS"

# ---------- 4. 在新增扰动中找能匹配桥接预订的候选 ----------
say "4. 候选匹配（Guest 的宽日期预订 × 新扰动）"
DID=""; BID=""
for nid in $NEW_IDS; do
  CAND=$(api GET "/api/coordinator/disruptions/${nid}/candidates")
  HIT=$(printf '%s' "$CAND" | pyexec "
import json,sys
items=json.load(sys.stdin).get('data') or []
for i in items:
    if 'CONF-DEMO-' in json.dumps(i):
        print(i.get('id') or i.get('bookingId')); break")
  if [ -n "$HIT" ]; then DID="$nid"; BID="$HIT"
    printf '%s' "$CAND" | pyexec "
import json,sys
for i in json.load(sys.stdin)['data']:
    if 'CONF-DEMO-' in json.dumps(i): print('  命中:', i.get('confirmationNo','?')); break"
    break
  fi
done

FALLBACK=0
if [ -z "${DID:-}" ]; then
  echo "  ⚠️ 真实天气没有触发 Auckland（Lambda 只探测到其他城市或零风险窗口）。"
  if [ -z "$INGEST_KEY" ]; then echo "  ❌ 且无 INGEST_KEY，无法回退。"; exit 1; fi
  FALLBACK=1
  say "4b. 回退：直注 Auckland 演示扰动（与 Lambda 同一 ingest 入口）"
  TITLE="Demo Storm - Auckland $(date +%H:%M)"
  DS=$(date -u +%FT00:00:00+00:00)
  DE=$(dplus 7)T00:00:00+00:00
  ING=$(curl -s -X POST "${BASE}/api/ingest/disruptions" -H "Content-Type: application/json" -H "X-Ingest-Key: ${INGEST_KEY}" \
    -d "{\"Type\":\"weather\",\"Title\":\"${TITLE}\",\"Region\":\"Auckland\",\"StartAt\":\"${DS}\",\"EndAtOrWindow\":\"${DE}\",\"RawSignalText\":\"Seeded by demo script (fallback)\"}")
  DID=$(printf '%s' "$ING" | pyexec "import json,sys; print((json.load(sys.stdin).get('data') or {}).get('id',''))")
  [ -z "$DID" ] && { echo "❌ 回退 ingest 失败"; exit 1; }
  CAND=$(api GET "/api/coordinator/disruptions/${DID}/candidates")
  BID=$(printf '%s' "$CAND" | pyexec "
import json,sys
for i in json.load(sys.stdin).get('data') or []:
    if 'CONF-DEMO-' in json.dumps(i) or '${GUEST_NICK}' in json.dumps(i): print(i.get('id') or i.get('bookingId','')); break")
  [ -z "$BID" ] && { echo "❌ 回退候选也未命中"; exit 1; }
fi

# ---------- 5. 通知建案 + 方案推送 ----------
say "5. notify 建案 → regenerate → push"
api POST "/api/coordinator/disruptions/${DID}/candidates/notify" "{\"bookingIds\":[\"${BID}\"],\"priority\":\"high\"}" \
  | pyexec "import json,sys; d=json.load(sys.stdin); print('  notified:',(d.get('data') or {}).get('notified','?'),'✅' if d.get('code')==0 else d)"
CASE=$(api GET "/api/coordinator/queue")
D_TITLE=$(api GET "/api/coordinator/disruptions/${DID}" | pyexec "import json,sys; print(json.load(sys.stdin)['data'].get('title',''))")
CID=$(printf '%s' "$CASE" | pyexec "
import json,sys
def w(c):
    try: return [int(x) for x in c.get('waitTime','99:99:99').split(':')]
    except Exception: return [99,99,99]
mine=[c for c in json.load(sys.stdin)['data'] if c.get('guestNickname')=='${GUEST_NICK}' and c.get('disruptionTitle')=='${D_TITLE}']
mine.sort(key=w)
print(mine[-1]['caseId'] if mine else '')")
[ -z "$CID" ] && { echo "❌ 队列未找到新案件"; printf '%s\n' "$CASE"; exit 1; }
echo "  新案件: ${CID}"
api POST "/api/coordinator/cases/${CID}/options/regenerate" '{}' >/dev/null
PUSH=$(api POST "/api/coordinator/cases/${CID}/options/push" '{}')
printf '%s' "$PUSH" | pyexec "import json,sys; d=json.load(sys.stdin); print('  push:',(d.get('data') or {}).get('success'))"

# ---------- 6. 三端核验 ----------
say "6. 三端核验"
HOTEL_LOGIN="$HOTEL_EMAIL"
JAR_G="$(mktemp)"; JAR_H="$(mktemp)"
login_as() { curl -s -c "$1" -X POST "${BASE}/api/auth/login" -H "Content-Type: application/json" -d "{\"identifier\":\"$2\",\"password\":\"$3\"}" >/dev/null; }
login_as "$JAR_G" "$GUEST_EMAIL" "$DEMO_PASS"
ALERT=$(curl -s -b "$JAR_G" "${BASE}/api/notifications?page=1&pageSize=10" | pyexec "
import json,sys
d=json.load(sys.stdin); data=d.get('data') or {}
items=data.get('list') or data.get('items') or []
rel=[n for n in items if n.get('caseId')]
print(f'{len(rel)} 条相关通知(最新: {rel[0][\"title\"] if rel else \"-\"})')")
login_as "$JAR_H" "$HOTEL_LOGIN" "$DEMO_PASS"
# 清掉陈旧询单（属于已关闭旧案件的 pending），让酒店端只留当前案件这一条
curl -s -b "$JAR_H" "${BASE}/api/hotel/inquiries?status=pending" | pyexec "
import json,sys
for i in json.load(sys.stdin).get('data') or []:
    if i.get('caseId') and i['caseId'] != '${CID}':
        print(i['id'])" | while IFS= read -r iid; do
  [ -z "$iid" ] && continue
  curl -s -b "$JAR_H" -X POST "${BASE}/api/hotel/inquiries/${iid}/confirm" \
    -H "Content-Type: application/json" -d '{"newCheckIn":null,"newCheckOut":null,"note":"Stale inquiry from superseded demo run"}' >/dev/null
  echo "  已清理酒店端陈旧询单: ${iid}"
done
HINQ=$(curl -s -b "$JAR_H" "${BASE}/api/hotel/inquiries?status=pending" | pyexec "import json,sys; print(len(json.load(sys.stdin).get('data') or []))")
HOPT=$(curl -s -b "$JAR_H" "${BASE}/api/hotel/selected-options" | pyexec "import json,sys; print(len(json.load(sys.stdin).get('data') or []))")
rm -f "$JAR_G" "$JAR_H"
QCOUNT=$(printf '%s' "$CASE" | pyexec "import json,sys; print(len(json.load(sys.stdin)['data']))")

MODE=$([ "$FALLBACK" = "1" ] && echo "⚠️ 回退直注模式（真实天气未触发 Auckland）" || echo "✅ Lambda 真实触发全链路")
cat <<EOF

========================================
🎉 演示环境就绪（${MODE}）
----------------------------------------
① Coordinator (${COORD_EMAIL})：队列 ${QCOUNT} 条
② Guest (${GUEST_EMAIL} / ${GUEST_NICK})：${ALERT}
③ Hotel (${HOTEL_EMAIL})：询单 ${HINQ} 条 / 换房确认 ${HOPT} 条
----------------------------------------
站点: ${BASE}
案件直达: ${BASE}/cases/${CID}
Lambda 日志行: ${LOGLINE}
密码统一: ${DEMO_PASS}
========================================
EOF
