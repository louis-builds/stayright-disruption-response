#!/usr/bin/env bash
# 演示前清场：把三个 Web 端的 pending 全部清干净（自验证 + 重试直到真正归零）。
#
#   ./scripts/clean-demo-state.sh            # 默认打 prod（ictgs-team5）
#   BASE=https://xxx ./scripts/clean-demo-state.sh   # 打别的环境
#
# 清理内容（全部走正式 API，不直接碰库）：
#   ① Coordinator：关闭所有未结案件（不只 Alice）；resolve 所有 Demo Storm /
#      Storm near Wellington 扰动；协调员自己的通知全部已读
#   ② Guest：Alice 的全部通知标记已读（铃铛红点清零）
#   ③ Hotel：所有酒店前台账号的 pending 询单与
#      待确认换房方案全部确认掉（每轮后重新拉取验证，最多 5 轮），
#      酒店账号的通知全部已读
#
# 2026-09-18：配套的 seed-demo-full.sh / seed-demo-second-case.sh 已删除（用了
# SSM/Lambda，跟 prod 账户不兼容）。演示注水目前只剩 seed-hotels.sh 可用。
set -euo pipefail

# 2026-09-18：dev 账户已下线，prod（ictgs-team5）是唯一在跑的环境，默认值改指向它。
BASE="${BASE:-https://d1s582gz77wdm.cloudfront.net}"
COORD_EMAIL="${COORD_EMAIL:-coord1@example.com}"
COORD_PASS="${COORD_PASS:-Password123!}"
CLOSE_REASON="人工决议结案"
GUESTS=("Alice" "Bob" "Carol" "Dave" "Eve" "Test Guest1")
HOTELS=("Rotorua Thermal Front Desk" "Wellington Waterfront Front Desk" "Queenstown Lakeview Front Desk" \
  "Queenstown Central Park Front Desk" "Queenstown Alpine Front Desk" \
  "Auckland SkyTower Front Desk" "Auckland Airport Front Desk" \
  "Wellington Harbourfront Front Desk" "Wellington CBD Front Desk" \
  "Christchurch Riverside Front Desk" "Rotorua Lakeside Front Desk" "Test Hotel Auckland")
MAX_ROUNDS=5

JAR="$(mktemp)"; JAR2="$(mktemp)"
trap 'rm -f "$JAR" "$JAR2"' EXIT
login() { curl -s -c "$JAR" -X POST "${BASE}/api/auth/login" -H "Content-Type: application/json" -d "{\"identifier\":\"$1\",\"password\":\"$2\"}" >/dev/null; }
login_as() { curl -s -c "$JAR2" -X POST "${BASE}/api/auth/login" -H "Content-Type: application/json" -d "{\"identifier\":\"$1\",\"password\":\"$2\"}" >/dev/null; }
api() { curl -s -b "$JAR" -X "$1" "${BASE}$2" ${3:+-H "Content-Type: application/json" -d "$3"}; }
api2() { curl -s -b "$JAR2" -X "$1" "${BASE}$2" ${3:+-H "Content-Type: application/json" -d "$3"}; }
api_search() { curl -s -b "$JAR" -G "${BASE}/api/coordinator/search" --data-urlencode "q=$1"; }
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
pyexec() { python3 -c "$@"; }
# API 层失败要炸出来（后端业务错误是 HTTP 200 + code!=0，curl 层看不见）；错误走 stderr，不会被 >/dev/null 吞掉
assert_ok() { pyexec "import json,sys
try:
    d=json.load(sys.stdin)
except Exception as e:
    print('响应不是 JSON:', e, file=sys.stderr); sys.exit(1)
if d.get('code')!=0: print('API 错误:', d, file=sys.stderr); sys.exit(1)"; }

say "0. 登录协调员"
login "$COORD_EMAIL" "$COORD_PASS"
echo OK

# ---------- 1. 关闭所有未结案件 ----------
say "1. 关闭所有未结案件"
for g in "${GUESTS[@]}"; do
  api_search "$g" | pyexec "
import json,sys
for c in json.load(sys.stdin).get('data') or []:
    if c.get('status')!='closed': print(c['caseId'])" | while IFS= read -r cid; do
    [ -z "$cid" ] && continue
    api POST "/api/coordinator/cases/${cid}/close" \
      "{\"closeReason\":\"${CLOSE_REASON}\",\"resultSummary\":\"Cleared before demo.\"}" | assert_ok
    echo "  closed: ${cid} (${g})"
  done
done
Q=$(api GET "/api/coordinator/queue" | pyexec "import json,sys; print(len(json.load(sys.stdin)['data']))")
echo "  队列剩余 pending: ${Q}"

# ---------- 2. resolve 演示/重复扰动 ----------
say "2. resolve Demo Storm / Storm near Wellington 扰动"
api GET "/api/coordinator/disruptions" | pyexec "
import json,sys
for i in json.load(sys.stdin)['data']:
    t=i.get('title','')
    if i.get('status')=='active' and (t.startswith('Demo Storm') or t=='Storm near Wellington'):
        print(i['id'])" | while IFS= read -r did; do
  [ -z "$did" ] && continue
  api POST "/api/coordinator/disruptions/${did}/resolve" '{}' | assert_ok
  echo "  resolved: ${did}"
done

# ---------- 3. 通知已读（协调员 + Alice + 三家酒店） ----------
mark_all_read() { # $1=登录名（用 $JAR2 会话）
  local id
  api2 GET "/api/notifications?page=1&pageSize=100" | pyexec "
import json,sys
d=json.load(sys.stdin); data=d.get('data') or {}
for n in (data.get('list') or data.get('items') or []):
    if n.get('readAt') is None: print(n['id'])" | while IFS= read -r id; do
    [ -z "$id" ] && continue
    api2 POST "/api/notifications/${id}/read" '{}' | assert_ok >/dev/null
  done
}
say "3. 通知全部已读（协调员 / Alice / 酒店）"
for who in "$COORD_EMAIL" "Alice" "${HOTELS[@]}"; do
  login_as "$who" "$COORD_PASS"
  mark_all_read "$who"
  U=$(api2 GET "/api/notifications/unread-count" | pyexec "import json,sys; print((json.load(sys.stdin).get('data') or {}).get('count','?'))")
  echo "  ${who}: 未读 ${U}"
done

# ---------- 4. 酒店 pending 清零（带验证重试） ----------
say "4. 酒店 pending 清零（自验证，最多 ${MAX_ROUNDS} 轮）"
for h in "${HOTELS[@]}"; do
  login "$h" "$COORD_PASS"
  for round in $(seq 1 $MAX_ROUNDS); do
    PENDING=$(api GET "/api/hotel/inquiries?status=pending")
    OPTS=$(api GET "/api/hotel/selected-options")
    N=$(printf '%s\n%s' "$PENDING" "$OPTS" | pyexec "
import json,sys
lines=sys.stdin.read().splitlines()
inq=json.loads(lines[0]).get('data') or []
opt=[o for o in (json.loads(lines[1]).get('data') or []) if o.get('availability')=='pending']
print(len(inq)+len(opt))")
    [ "$N" = "0" ] && { echo "  ${h}: 待办 0 ✅"; break; }
    [ "$round" = "$MAX_ROUNDS" ] && { echo "  ❌ ${h}: ${MAX_ROUNDS} 轮后仍有 ${N} 条待办，请人工检查"; exit 1; }
    echo "  ${h}: 第 ${round} 轮确认 ${N} 条..."
    printf '%s' "$PENDING" | pyexec "
import json,sys
for i in json.load(sys.stdin).get('data') or []: print(i['id'])" | while IFS= read -r iid; do
      [ -z "$iid" ] && continue
      api POST "/api/hotel/inquiries/${iid}/confirm" \
        '{"newCheckIn":null,"newCheckOut":null,"note":"Cleared before demo."}' | assert_ok >/dev/null
    done
    printf '%s' "$OPTS" | pyexec "
import json,sys
for o in json.load(sys.stdin).get('data') or []:
    if o.get('availability')=='pending': print(o['optionId'])" | while IFS= read -r oid; do
      [ -z "$oid" ] && continue
      api POST "/api/hotel/selected-options/${oid}/confirm" '{}' | assert_ok >/dev/null
    done
    sleep 2
  done
done

cat <<EOF

========================================
🧹 清场完成（已逐项验证归零）
① Coordinator 队列 pending: ${Q}
② 通知未读：协调员 / Alice / 全部酒店前台均已清零（见上）
③ 酒店 pending 询单/方案: 全部确认
演示注水目前只剩 ./scripts/seed-hotels.sh 可用（seed-demo-full.sh 已删除）
========================================
EOF
