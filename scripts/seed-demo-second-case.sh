#!/usr/bin/env bash
# 第二个演示案件种子脚本（同店版）：与 seed-demo-full.sh 建立的第一个案件（Wellington 风暴 ×
# CONF-DEMO-WLG）同一家酒店、并行共存、互不冲突。
#
#   ./scripts/seed-demo-second-case.sh
#
# 账号与 seed-demo-full.sh 完全同一批（密码统一 Password123!），酒店端始终只登录
# Wellington Waterfront Front Desk 这一个账号——两个案件靠 Alice 的两条预订区分：
#   案件一 CONF-DEMO-WLG   Harbour View Queen  原日期（seed-demo-full 维护）
#   案件二 CONF-DEMO-WLG2  City View King      日期 = 案件一 +14 天（本脚本维护）
# City View King 是本脚本经酒店 API 自动补插的第二个房型（酒店原本只有 Harbour View Queen）。
#
# 与 seed-demo-full.sh 的三点关键差异（都是为了"不干扰第一个案件"）：
#   1. 不执行它的第 0 步（关闭 Alice 遗留案件）——那会把第一个演示案件一起关掉
#   2. 不执行它的第 6 步（清理"陈旧询单"）——那会把 Wellington 酒店挂着的 H1 询单确认掉
#   3. 不 invoke Lambda、走确定性直注 ingest——真实天气不可控；扰动窗口按 WLG2 预订日期生成，
#      与案件一的日期窗错开 14 天，两个扰动的候选匹配互不命中对方的预订
#
# 它做八件事：
#   1. 幂等检查：已存在 "Demo Storm 2 - Wellington" 未结案件 → 打印现状直接退出
#   2. 酒店端补插房型 City View King（已存在则跳过）
#   3. 以 Alice 身份读案件一预订日期 → 推导 WLG2 日期(+14天) → 经 EC2 SSM 幂等补插预订
#   4. 快照案件一现状（Wellington 询单明细 + 案件状态），收尾时比对，保证零干扰
#   5. 直注 Wellington 扰动（标题带时间戳；以 "Demo Storm" 开头，clean-demo-state.sh 可整体清掉）
#   6. candidates 命中 CONF-DEMO-WLG2 → notify 建案
#   7. regenerate + push 方案
#   8. 核验：Wellington 酒店待办 = 快照 +1（新增且仅新增 WLG2 一张卡）；案件一原卡与状态不变
#
# 前置：scripts/.env.demo 里有 INGEST_KEY；AWS 凭证可用（WLG2 预订每次重建都走 EC2 SSM）。
set -euo pipefail

BASE="${BASE:?Set BASE (no cross-account default, e.g. https://<your-cloudfront-domain>)}"
REGION_AWS="${AWS_REGION:-ap-southeast-2}"
EC2_ID="${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID (no cross-account default)}"
COORD_EMAIL="${COORD_EMAIL:-coord1@example.com}"
COORD_PASS="${COORD_PASS:-Password123!}"
GUEST_NICK="${GUEST_NAME:-Alice}"
HOTEL_WLG="${HOTEL_WLG:-Wellington Waterfront Front Desk}"
BRIDGE_HOTEL="Wellington Waterfront Hotel"
FIRST_CONF="${FIRST_CONF:-CONF-DEMO-WLG}"
BRIDGE_CONF="${BRIDGE_CONF:-CONF-DEMO-WLG2}"
ROOM_TYPE="${ROOM_TYPE:-City View King}"
DATE_OFFSET_DAYS="${DATE_OFFSET_DAYS:-14}"
TITLE_PREFIX="Demo Storm 2 - Wellington"
PRIORITY="${PRIORITY:-high}"

cd "$(dirname "$0")"
if [ -f .env.demo ]; then source .env.demo; fi
INGEST_KEY="${INGEST_KEY:-}"
[ -n "$INGEST_KEY" ] || { echo "❌ 缺少 INGEST_KEY（scripts/.env.demo）"; exit 1; }

JAR="$(mktemp)"; JAR_G="$(mktemp)"; JAR_H="$(mktemp)"
trap 'rm -f "$JAR" "$JAR_G" "$JAR_H"' EXIT
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
pyexec() { python3 -c "$@"; }
api()   { curl -s -b "$JAR"   -X "$1" "${BASE}$2" ${3:+-H "Content-Type: application/json" -d "$3"}; }
api_g() { curl -s -b "$JAR_G" -X "$1" "${BASE}$2" ${3:+-H "Content-Type: application/json" -d "$3"}; }
api_h() { curl -s -b "$JAR_H" -X "$1" "${BASE}$2" ${3:+-H "Content-Type: application/json" -d "$3"}; }
login_as() { curl -s -c "$1" -X POST "${BASE}/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$2\",\"password\":\"$3\"}" >/dev/null; }
# API 层失败要炸出来（后端业务错误是 HTTP 200 + code!=0，curl 层看不见）
assert_ok() { pyexec "import json,sys
try:
    d=json.load(sys.stdin)
except Exception as e:
    print('响应不是 JSON:', e, file=sys.stderr); sys.exit(1)
if d.get('code')!=0: print('API 错误:', d, file=sys.stderr); sys.exit(1)"; }
dshift() { # $1=基准日期 $2=BSD -v 偏移(+14d/-1d) $3=GNU 文字("+14 days"/"-1 day")
  date -j -f "%Y-%m-%d" -v"$2" "$1" +%F 2>/dev/null || date -d "$1 $3" +%F
}

# ---------- 0. 登录 ----------
say "0. 登录（协调员 / Alice / Wellington 酒店）"
login_as "$JAR"   "$COORD_EMAIL" "$COORD_PASS"
login_as "$JAR_G" "$GUEST_NICK"  "$COORD_PASS"
login_as "$JAR_H" "$HOTEL_WLG"   "$COORD_PASS"
echo OK

# ---------- 1. 幂等：已存在本脚本建的未结案件就直接退出 ----------
say "1. 幂等检查（${TITLE_PREFIX}*）"
EXISTING=$(api GET "/api/coordinator/queue" | pyexec "
import json,sys
for c in json.load(sys.stdin).get('data') or []:
    if c.get('guestNickname')=='${GUEST_NICK}' and (c.get('disruptionTitle') or '').startswith('${TITLE_PREFIX}'):
        print(c['caseId']); break")
if [ -n "$EXISTING" ]; then
  echo "  已存在第二个演示案件: ${EXISTING}（如需重建，先在协调员端关闭它再重跑本脚本）"
  exit 0
fi
echo "  无重复，继续"

# ---------- 2. 酒店端补插房型 City View King ----------
say "2. 确保房型 ${ROOM_TYPE} 存在（酒店原本只有 Harbour View Queen）"
HAS_RT=$(api_h GET "/api/hotel/profile" | pyexec "
import json,sys
d=json.load(sys.stdin).get('data') or {}
print('yes' if any(r.get('name')=='${ROOM_TYPE}' for r in d.get('roomTypes') or []) else 'no')")
if [ "$HAS_RT" = "yes" ]; then
  echo "  已存在，跳过"
else
  api_h POST "/api/hotel/profile/room-types" \
    "{\"name\":\"${ROOM_TYPE}\",\"description\":\"King room with city skyline view\",\"amenities\":[\"Free Wi-Fi\",\"Air conditioning\"],\"capacity\":2,\"priceAmount\":280,\"currency\":\"NZD\",\"imageUrls\":[]}" \
    | assert_ok >/dev/null
  echo "  已新增 ${ROOM_TYPE}"
fi

# ---------- 3. 推导 WLG2 日期 → SSM 幂等补插预订 ----------
say "3. 按 ${FIRST_CONF} 日期 +${DATE_OFFSET_DAYS} 天推导，补插 ${BRIDGE_CONF}（${ROOM_TYPE}）"
FIRST_ROW=$(api_g GET "/api/bookings/mine" | pyexec "
import json,sys
for b in json.load(sys.stdin).get('data') or []:
    if b.get('confirmationNo')=='${FIRST_CONF}':
        print((b.get('checkIn') or '') + ' ' + (b.get('checkOut') or '')); break")
if [ -n "$FIRST_ROW" ]; then
  BASE_CI=$(printf '%s' "$FIRST_ROW" | cut -d' ' -f1)
  BASE_CO=$(printf '%s' "$FIRST_ROW" | cut -d' ' -f2)
else
  echo "  ⚠️ 找不到 ${FIRST_CONF}，日期退化为今天+15/+19"
  BASE_CI=$(dshift "$(date +%F)" +15d "+15 days")
  BASE_CO=$(dshift "$(date +%F)" +19d "+19 days")
fi
CI=$(dshift "$BASE_CI" "+${DATE_OFFSET_DAYS}d" "+${DATE_OFFSET_DAYS} days")
CO=$(dshift "$BASE_CO" "+${DATE_OFFSET_DAYS}d" "+${DATE_OFFSET_DAYS} days")
echo "  案件一 ${BASE_CI} → ${BASE_CO}｜案件二 ${CI} → ${CO}（错开 ${DATE_OFFSET_DAYS} 天，互不命中）"

SQL=$(cat <<EOSQL
INSERT INTO bookings (id, confirmation_no, guest_user_id, hotel_id, room_type_id,
                      check_in, check_out, guests_count, total_amount, currency, status, created_at, updated_at)
SELECT gen_random_uuid(), '${BRIDGE_CONF}', u.id, h.id,
       (SELECT id FROM room_types WHERE hotel_id = h.id AND name = '${ROOM_TYPE}'),
       :'cin'::date, :'cout'::date, 2, 560.00, 'NZD', 'confirmed', now(), now()
FROM users u JOIN hotels h ON h.name = '${BRIDGE_HOTEL}'
WHERE u.nickname = '${GUEST_NICK}'
ON CONFLICT (confirmation_no) DO UPDATE
  SET check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out, updated_at = now();
EOSQL
)
B64=$(printf '%s' "$SQL" | base64 | tr -d '\n')
CMD_ID=$(aws ssm send-command --region "$REGION_AWS" --instance-ids "$EC2_ID" \
  --document-name AWS-RunShellScript --comment "demo seed 2: booking ${BRIDGE_CONF}" \
  --parameters "commands=[\"echo ${B64} | base64 -d > /tmp/demo_seed2.sql && sudo docker exec -i pg psql -U app -d stayright -v ON_ERROR_STOP=1 -v cin=${CI} -v cout=${CO} < /tmp/demo_seed2.sql && rm -f /tmp/demo_seed2.sql\"]" \
  --output text --query 'Command.CommandId')
for i in $(seq 1 20); do
  ST=$(aws ssm get-command-invocation --region "$REGION_AWS" --command-id "$CMD_ID" --instance-id "$EC2_ID" --query Status --output text 2>/dev/null) && [ "$ST" != "InProgress" ] && [ "$ST" != "Pending" ] && break
  sleep 2
done
[ "${ST:-}" = "Success" ] || { aws ssm get-command-invocation --region "$REGION_AWS" --command-id "$CMD_ID" --instance-id "$EC2_ID" --query StandardErrorContent --output text 2>/dev/null; echo "❌ 预订补插失败"; exit 1; }

ZQN_ROW=$(api_g GET "/api/bookings/mine" | pyexec "
import json,sys
for b in json.load(sys.stdin).get('data') or []:
    if b.get('confirmationNo')=='${BRIDGE_CONF}':
        print('|'.join(str(b.get(k) or '') for k in ('id','checkIn','checkOut','roomTypeName','caseId','caseStatus')))
        break")
[ -n "$ZQN_ROW" ] || { echo "❌ 补插后仍未找到 ${BRIDGE_CONF}（检查酒店名 ${BRIDGE_HOTEL} / 房型 ${ROOM_TYPE}）"; exit 1; }
BID=$(printf '%s' "$ZQN_ROW" | cut -d'|' -f1)
RT_GOT=$(printf '%s' "$ZQN_ROW" | cut -d'|' -f4)
CASE_ST=$(printf '%s' "$ZQN_ROW" | cut -d'|' -f6)
echo "  ${BRIDGE_CONF}: ${CI} → ${CO}｜${RT_GOT}（bookingId ${BID}）"
if [ -n "$CASE_ST" ] && [ "$CASE_ST" != "closed" ]; then
  echo "❌ ${BRIDGE_CONF} 上已有未结案件（$(printf '%s' "$ZQN_ROW" | cut -d'|' -f5)，状态 ${CASE_ST}），但不是本脚本建的。"
  echo "   先在协调员端处理/关闭它再重跑。"
  exit 1
fi

# ---------- 4. 快照案件一现状（收尾比对，保证零干扰） ----------
say "4. 快照案件一（${FIRST_CONF}）现状"
snap_wlg() { # 输出: 询单明细(确认号:询单id,逗号分隔)/待确认方案数/案件id/案件状态
  local inq opt st
  inq=$(api_h GET "/api/hotel/inquiries?status=pending" | pyexec "
import json,sys
print(','.join('%s:%s' % (i.get('confirmationNo'), i['id']) for i in json.load(sys.stdin).get('data') or []))")
  opt=$(api_h GET "/api/hotel/selected-options" | pyexec "import json,sys; d=json.load(sys.stdin).get('data') or []; print(sum(1 for o in d if o.get('availability')=='pending'))")
  st=$(api_g GET "/api/bookings/mine" | pyexec "
import json,sys
for b in json.load(sys.stdin).get('data') or []:
    if b.get('confirmationNo')=='${FIRST_CONF}':
        print((b.get('caseId') or '') + '/' + (b.get('caseStatus') or '-')); break")
  echo "${inq}/${opt}/${st}"
}
cmp_snap() { # $1=before $2=after；断言:案件一原卡全在、新增且仅新增 WLG2、方案数与案件状态不变
  python3 - "$1" "$2" "${BRIDGE_CONF}" <<'PY'
import sys
b_inq, b_opt, b_case = sys.argv[1].split('/', 2)
a_inq, a_opt, a_case = sys.argv[2].split('/', 2)
b = dict(x.rsplit(':', 1) for x in filter(None, b_inq.split(',')))
a = dict(x.rsplit(':', 1) for x in filter(None, a_inq.split(',')))
new = sorted(c for c in a if c not in b)
gone = sorted(c for c in b if c not in a)
if new == [sys.argv[3]] and not gone and b_opt == a_opt and b_case == a_case:
    print('OK')
else:
    print(f'FAIL new={new} gone={gone} opt {b_opt}->{a_opt} case {b_case}->{a_case}')
    sys.exit(1)
PY
}
WLG_BEFORE="$(snap_wlg)"
echo "  Wellington 待办询单: $(printf '%s' "$WLG_BEFORE" | cut -d'/' -f1 | tr ',' ' ')｜待确认方案 $(printf '%s' "$WLG_BEFORE" | cut -d'/' -f2)"
echo "  案件一: $(printf '%s' "$WLG_BEFORE" | cut -d'/' -f3-4)"

# ---------- 5. 直注 Wellington 扰动 ----------
say "5. 直注扰动（窗口按 WLG2 预订日期生成，与案件一日期窗错开）"
TITLE="${TITLE_PREFIX} $(date +%m-%d\ %H:%M)"
W_START="$(dshift "$CI" -1d '-1 day')T00:00:00+00:00"
W_END="$(dshift "$CO" +1d '+1 day')T00:00:00+00:00"
ING=$(curl -s -X POST "${BASE}/api/ingest/disruptions" -H "Content-Type: application/json" -H "X-Ingest-Key: ${INGEST_KEY}" \
  -d "{\"type\":\"weather\",\"title\":\"${TITLE}\",\"region\":\"Wellington\",\"startAt\":\"${W_START}\",\"endAtOrWindow\":\"${W_END}\",\"rawSignalText\":\"Seeded by demo second-case script\"}")
printf '%s' "$ING" | assert_ok
DID=$(printf '%s' "$ING" | pyexec "import json,sys; print((json.load(sys.stdin).get('data') or {}).get('id',''))")
[ -n "$DID" ] || { echo "❌ ingest 未返回扰动 id"; exit 1; }
echo "  扰动: ${TITLE}（${W_START%T*} → ${W_END%T*}）id ${DID}"

# ---------- 6. 候选命中 → notify 建案 ----------
say "6. 候选匹配 → notify 建案"
CAND=$(api GET "/api/coordinator/disruptions/${DID}/candidates")
BID2=$(printf '%s' "$CAND" | pyexec "
import json,sys
for i in json.load(sys.stdin).get('data') or []:
    if i.get('confirmationNo')=='${BRIDGE_CONF}': print(i['bookingId']); break")
[ -n "$BID2" ] || { echo "❌ 候选未命中 ${BRIDGE_CONF}（检查 ${BRIDGE_HOTEL} 的 address 是否含 Wellington）"; printf '%s\n' "$CAND"; exit 1; }
EXTRA=$(printf '%s' "$CAND" | pyexec "
import json,sys
hit=[i['confirmationNo'] for i in json.load(sys.stdin).get('data') or [] if i.get('confirmationNo')=='${FIRST_CONF}']
if hit: print('候选还命中了案件一的预订 ' + ','.join(hit))")
[ -z "$EXTRA" ] || { echo "❌ ${EXTRA}——日期窗撞了，中止"; exit 1; }
echo "  命中: ${BRIDGE_CONF}（bookingId ${BID2}），未误伤 ${FIRST_CONF} ✅"
NOTIFY=$(api POST "/api/coordinator/disruptions/${DID}/candidates/notify" "{\"bookingIds\":[\"${BID2}\"],\"priority\":\"${PRIORITY}\"}")
printf '%s' "$NOTIFY" | assert_ok >/dev/null
printf '%s' "$NOTIFY" | pyexec "import json,sys; print('  notified:',(json.load(sys.stdin).get('data') or {}).get('notified'),'✅（priority ${PRIORITY}）')"

# ---------- 7. 定位新案件 → regenerate → push ----------
say "7. 定位新案件 → regenerate → push"
CASE=$(api GET "/api/coordinator/queue")
CID=$(printf '%s' "$CASE" | pyexec "
import json,sys
for c in json.load(sys.stdin).get('data') or []:
    if c.get('guestNickname')=='${GUEST_NICK}' and c.get('disruptionTitle')=='${TITLE}':
        print(c['caseId']); break")
[ -n "$CID" ] || { echo "❌ 队列未找到新案件"; printf '%s\n' "$CASE"; exit 1; }
echo "  新案件: ${CID}"
api POST "/api/coordinator/cases/${CID}/options/regenerate" '{}' | assert_ok >/dev/null
PUSH=$(api POST "/api/coordinator/cases/${CID}/options/push" '{}')
printf '%s' "$PUSH" | assert_ok >/dev/null
printf '%s' "$PUSH" | pyexec "import json,sys; print('  push:',(json.load(sys.stdin).get('data') or {}).get('success'))"

# ---------- 8. 核验（含对案件一的零干扰断言） ----------
say "8. 核验"
WLG_AFTER="$(snap_wlg)"
VERDICT=$(cmp_snap "$WLG_BEFORE" "$WLG_AFTER") || true
[ "$VERDICT" = "OK" ] || { echo "❌ 零干扰断言失败：${VERDICT}"; exit 1; }
echo "  案件一零干扰 ✅（原卡未动、方案数与案件状态不变，仅新增 ${BRIDGE_CONF} 一张卡）"
QCOUNT=$(printf '%s' "$CASE" | pyexec "import json,sys; print(len(json.load(sys.stdin)['data']))")
HINQ=$(api_h GET "/api/hotel/inquiries?status=pending" | pyexec "import json,sys; print(len(json.load(sys.stdin).get('data') or []))")

cat <<EOF

========================================
🎉 第二个演示案件就绪（同店双案：Wellington Waterfront Front Desk）
----------------------------------------
案件一: ${FIRST_CONF}（Harbour View Queen，${BASE_CI} → ${BASE_CO}）
   case $(printf '%s' "$WLG_BEFORE" | cut -d'/' -f3)  状态 $(printf '%s' "$WLG_BEFORE" | cut -d'/' -f4)
案件二: ${BRIDGE_CONF}（${ROOM_TYPE}，${CI} → ${CO}）
   case ${CID}
----------------------------------------
① Coordinator (${COORD_EMAIL})：队列 ${QCOUNT} 条
② Guest (登录名: ${GUEST_NICK})：名下两个未结案件并存
③ Hotel (登录名: ${HOTEL_WLG})：待办询单 ${HINQ} 条（两张卡靠确认号/日期/房型区分）
----------------------------------------
站点: ${BASE}
案件二直达: ${BASE}/cases/${CID}
密  码统一: Password123!
清理提示: clean-demo-state.sh 会把两个案件一起清掉（它的职责就是全量清场）
========================================
EOF
