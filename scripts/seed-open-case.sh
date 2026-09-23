#!/usr/bin/env bash
# 造一条"活跃"案件用于本地测试（改签方案流程/酒店询单确认/升级台/方案管理这些
# 只有 open case 才能走到的页面，种子数据里全是 closed case，测不到）。
#
#   ./scripts/seed-open-case.sh                       # 默认打本地后端 localhost:5006
#   BASE=https://xxx ./scripts/seed-open-case.sh       # 打别的环境
#   GUEST_EMAIL=bob@example.com ./scripts/seed-open-case.sh   # 换一个候选客人
#
# 做的事（全部走正式协调员 API，不直接碰库）：
#   1. 登录协调员，找一条 region=Queenstown 的 active 扰动（种子数据里有，
#      affectedCount=0，从没被用过）
#   2. 把它的时间窗改宽（覆盖到 2026 年底），这样未来入住的预订才会进候选名单
#      ——候选匹配逻辑是 booking.CheckIn <= 扰动窗口结束（DisruptionRepository.
#      ListCandidateBookingsAsync），种子扰动的窗口只有原设定的 1 小时，早过期了
#   3. 查候选名单，挑 GUEST_EMAIL 对应的预订（默认 alice@example.com 的
#      CONF-0001，Queenstown Lakeview Hotel）
#   4. POST candidates/notify 建案——这一步和协调员在 UI 上手动点
#      "Notify guests" 完全是同一条代码路径（DisruptionService.
#      NotifyCandidatesAsync）：建 Case（pending）+ 系统开场白消息 + 指派协调员
#      + 建一条 deferral 询单给酒店
#
# 建完之后人工在浏览器里走完整流程（这样测的才是真实交互，不是脚本模拟）：
#   - 酒店端登录对应前台账号，确认/拒绝这条询单 → 触发方案生成
#   - Guest 端 /cases/:id/options 选方案
#   - Coordinator 端 /coordinator/cases/:id/escalation、/coordinator/cases/:id/options
#
# 清理：跑 ./scripts/clean-demo-state.sh 会把这条 case 关掉、扰动 resolve 掉，
# 和其他演示数据一起归零。
set -euo pipefail

BASE="${BASE:-http://localhost:5006}"
COORD_EMAIL="${COORD_EMAIL:-coord1@example.com}"
COORD_PASS="${COORD_PASS:-Password123!}"
GUEST_EMAIL="${GUEST_EMAIL:-alice@example.com}"
PRIORITY="${PRIORITY:-high}"

JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
pyexec() { python3 -c "$@"; }
login() { curl -s -c "$JAR" -X POST "${BASE}/api/auth/login" -H "Content-Type: application/json" -d "{\"identifier\":\"$1\",\"password\":\"$2\"}"; }
api() { curl -s -b "$JAR" -X "$1" "${BASE}$2" ${3:+-H "Content-Type: application/json" -d "$3"}; }
assert_ok() { pyexec "import json,sys
try:
    d=json.load(sys.stdin)
except Exception as e:
    print('响应不是 JSON:', e, file=sys.stderr); sys.exit(1)
if d.get('code')!=0: print('API 错误:', d, file=sys.stderr); sys.exit(1)
print(json.dumps(d))"; }

say "1. 登录协调员 (${COORD_EMAIL})"
LOGIN=$(login "$COORD_EMAIL" "$COORD_PASS")
printf '%s' "$LOGIN" | pyexec "import json,sys; sys.exit(0 if json.load(sys.stdin).get('code')==0 else 1)" \
  || { echo "❌ 登录失败: $LOGIN"; exit 1; }
echo "OK"

say "2. 找一条可复用的 active 扰动（region=Queenstown）"
DISRUPTION_ID="${DISRUPTION_ID:-$(api GET "/api/coordinator/disruptions" | pyexec "
import json,sys
for d in json.load(sys.stdin)['data']:
    if d.get('status')=='active' and 'Queenstown' in (d.get('region') or ''):
        print(d['id']); break")}"
[ -z "$DISRUPTION_ID" ] && { echo "❌ 没找到 region=Queenstown 的 active 扰动，种子数据可能变了，改用 DISRUPTION_ID=<id> 手动指定"; exit 1; }
echo "  用扰动: ${DISRUPTION_ID}"

say "3. 把扰动时间窗改宽，覆盖未来预订"
api PUT "/api/coordinator/disruptions/${DISRUPTION_ID}/window" \
  '{"startAt":"2026-09-01T00:00:00Z","endAtOrWindow":"2026-12-31T00:00:00Z"}' | assert_ok >/dev/null
echo "  窗口: 2026-09-01 → 2026-12-31"

say "4. 查候选名单，挑 ${GUEST_EMAIL} 的预订"
BOOKING_JSON=$(api GET "/api/coordinator/disruptions/${DISRUPTION_ID}/candidates")
BOOKING_ID=$(printf '%s' "$BOOKING_JSON" | pyexec "
import json,sys
guest_prefix='${GUEST_EMAIL}'.split('@')[0].capitalize()
data=json.load(sys.stdin)['data']
for b in data:
    if b.get('guestNickname','').lower().startswith(guest_prefix.lower()):
        print(b['bookingId']); break
else:
    if data: print(data[0]['bookingId'])")
[ -z "$BOOKING_ID" ] && { echo "❌ 候选名单是空的: $BOOKING_JSON"; exit 1; }
echo "  用预订: ${BOOKING_ID}"

say "5. 建案（POST candidates/notify，priority=${PRIORITY}）"
RESULT=$(api POST "/api/coordinator/disruptions/${DISRUPTION_ID}/candidates/notify" \
  "{\"bookingIds\":[\"${BOOKING_ID}\"],\"priority\":\"${PRIORITY}\"}")
printf '%s' "$RESULT" | assert_ok >/dev/null || { echo "❌ 建案失败: $RESULT"; exit 1; }

say "6. 核验"
CASE_ID=$(api GET "/api/coordinator/disruptions/${DISRUPTION_ID}/cases" | pyexec "
import json,sys
data=json.load(sys.stdin)['data']
if data: print(data[0]['caseId'])")

cat <<EOF

========================================
✅ Open case 建好了
扰动: ${DISRUPTION_ID}
案件: ${CASE_ID:-（查询失败，去 coordinator queue 里手动找）}
预订: ${BOOKING_ID}（${GUEST_EMAIL}）
状态: pending，priority=${PRIORITY}
已自动: 建了一条给酒店的 deferral 询单，等酒店端确认/拒绝

前端直接打开:
  http://localhost:5173/cases/${CASE_ID:-<case-id>}
  http://localhost:5173/coordinator/cases/${CASE_ID:-<case-id>}/options
  http://localhost:5173/coordinator/cases/${CASE_ID:-<case-id>}/escalation

清理: ./scripts/clean-demo-state.sh（会把这条 case 一起关掉）
========================================
EOF
