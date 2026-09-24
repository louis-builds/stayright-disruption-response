#!/usr/bin/env bash
# 向已部署环境批量注入演示酒店（纯公开 API，无需 AWS/数据库权限）。
#
#   ./scripts/seed-hotels.sh            # 默认打 prod（ictgs-team5），注入 scripts/hotels-seed.json 里全部酒店
#   BASE=https://xxx ./scripts/seed-hotels.sh   # 打别的环境
#
# 对每家酒店做三件事（幂等，可重复跑）：
#   1. POST /api/auth/register   建酒店 + 房型 + 前台账号（邮箱已存在则跳过建店）
#   2. 用新账号登录
#   3. PUT /api/hotel/profile/refund-policy  写入取消/退款政策（会自动进 RAG 索引）
#
# 最后逐店核验 GET /api/hotel/profile 与 refund-policy，打印账号清单。
# 数据源与 backend/SeedData 一致（本地全新环境由 SeedRunner 自动带上）。
set -euo pipefail

# 2026-09-18：dev 账户已下线，prod（ictgs-team5）是唯一在跑的环境，默认值改指向它。
BASE="${BASE:-https://d1s582gz77wdm.cloudfront.net}"
DATA="${DATA:-$(dirname "$0")/hotels-seed.json}"

JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
pyexec() { python3 -c "$@"; }

# 汇总每店结果：name|email|register|policy
RESULTS="$(mktemp)"
COUNT=$(pyexec "import json; print(len(json.load(open('$DATA'))))")

for i in $(seq 0 $((COUNT - 1))); do
  ENTRY=$(pyexec "import json; print(json.dumps(json.load(open('$DATA'))[$i]))")
  EMAIL=$(printf '%s' "$ENTRY" | pyexec "import json,sys; print(json.load(sys.stdin)['email'])")
  NICK=$(printf '%s' "$ENTRY" | pyexec "import json,sys; print(json.load(sys.stdin)['nickname'])")
  HNAME=$(printf '%s' "$ENTRY" | pyexec "import json,sys; print(json.load(sys.stdin)['hotel']['name'])")
  PASS=$(printf '%s' "$ENTRY" | pyexec "import json,sys; print(json.load(sys.stdin)['password'])")

  say "[$((i + 1))/$COUNT] $HNAME"

  # ---- 1. register（幂等：邮箱已存在视为已注入） ----
  REG_PAYLOAD=$(printf '%s' "$ENTRY" | pyexec "
import json,sys
e=json.load(sys.stdin)
print(json.dumps({
  'email': e['email'], 'phone': e['phone'], 'nickname': e['nickname'],
  'password': e['password'], 'confirmPassword': e['password'],
  'role': 'hotel', 'hotel': e['hotel'],
}))")
  REG=$(curl -s -X POST "${BASE}/api/auth/register" -H "Content-Type: application/json" -d "$REG_PAYLOAD")
  REG_CODE=$(printf '%s' "$REG" | pyexec "import json,sys; print(json.load(sys.stdin).get('code'))")
  REG_STATE="created"
  if [ "$REG_CODE" != "0" ]; then
    if printf '%s' "$REG" | pyexec "import json,sys; sys.exit(0 if 'already' in json.dumps(json.load(sys.stdin)).lower() else 1)"; then
      REG_STATE="exists"
    else
      echo "  ❌ 注册失败: $REG"; echo "$HNAME|$EMAIL|FAIL|$REG" >> "$RESULTS"; continue
    fi
  fi
  echo "  酒店+账号: $REG_STATE ($EMAIL)"

  # ---- 2. 登录该酒店前台账号 ----
  LOGIN=$(curl -s -c "$JAR" -X POST "${BASE}/api/auth/login" -H "Content-Type: application/json" \
    -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASS\"}")
  if ! printf '%s' "$LOGIN" | pyexec "import json,sys; sys.exit(0 if json.load(sys.stdin).get('code')==0 else 1)"; then
    echo "  ❌ 登录失败: $LOGIN"; echo "$HNAME|$EMAIL|$REG_STATE|LOGIN_FAIL" >> "$RESULTS"; continue
  fi

  # ---- 3. 同步房型（已存在的酒店用种子数据覆盖描述/价格，保证语言与内容最新） ----
  PROF=$(curl -s -b "$JAR" "${BASE}/api/hotel/profile")
  SYNC=$(printf '%s' "$ENTRY" | pyexec "
import json,sys
entry=json.load(open('$DATA'))[$i]
prof=json.loads(sys.stdin.read()).get('data') or {}
existing={r['name']: r['id'] for r in prof.get('roomTypes') or []}
for rt in entry['hotel']['roomTypes']:
    rid=existing.get(rt['name'])
    if not rid:
        print('missing:'+rt['name']); continue
    print(json.dumps({'id': rid, 'payload': {
        'name': rt['name'], 'description': rt['description'], 'amenities': rt['amenities'],
        'capacity': rt['capacity'], 'priceAmount': rt['priceAmount'],
        'currency': rt['currency'], 'imageUrls': []}}))
" <<< "$PROF")
  RT_OK=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in
      missing:*) echo "  ⚠️  线上缺房型 ${line#missing:}（注册时未建，需手工补）"; continue ;;
    esac
    RTID=$(printf '%s' "$line" | pyexec "import json,sys; print(json.load(sys.stdin)['id'])")
    RTP=$(printf '%s' "$line" | pyexec "import json,sys; print(json.dumps(json.load(sys.stdin)['payload']))")
    curl -s -b "$JAR" -X PUT "${BASE}/api/hotel/profile/room-types/${RTID}" \
      -H "Content-Type: application/json" -d "$RTP" | pyexec "import json,sys; sys.exit(0 if json.load(sys.stdin).get('code')==0 else 1)" && RT_OK=$((RT_OK+1)) || echo "  ⚠️  房型更新失败: $RTID"
  done <<< "$SYNC"
  echo "  房型同步: ${RT_OK} 个"

  # ---- 4. 写入退款政策 ----
  PUT_PAYLOAD=$(printf '%s' "$ENTRY" | pyexec "
import json,sys
p=json.load(sys.stdin)['policy']
print(json.dumps({'content': p['content'], 'structuredRulesJson': p['structuredRulesJson'],
                  'effectiveFrom': None, 'effectiveUntil': None, 'isActive': True}))")
  PUT=$(curl -s -b "$JAR" -X PUT "${BASE}/api/hotel/profile/refund-policy" \
    -H "Content-Type: application/json" -d "$PUT_PAYLOAD")
  if printf '%s' "$PUT" | pyexec "import json,sys; sys.exit(0 if json.load(sys.stdin).get('code')==0 else 1)"; then
    POL_STATE="policy ✓"
  else
    POL_STATE="policy ✗ ($PUT)"
  fi
  echo "  退款政策: $POL_STATE"

  # ---- 4. 核验 profile ----
  PROF=$(curl -s -b "$JAR" "${BASE}/api/hotel/profile")
  RT_COUNT=$(printf '%s' "$PROF" | pyexec "import json,sys; d=json.load(sys.stdin).get('data') or {}; print(len(d.get('roomTypes') or []))")
  echo "  核验: 房型 ${RT_COUNT} 个"
  echo "$HNAME|$EMAIL|$REG_STATE|$POL_STATE|房型${RT_COUNT}" >> "$RESULTS"
  rm -f "$JAR"; JAR="$(mktemp)"
done

say "汇总（统一密码 Password123!）"
printf '%-38s %-26s %-10s %s\n' "酒店" "登录账号(email)" "注入" "政策"
echo  "--------------------------------------------------------------------------"
sort "$RESULTS" | awk -F'|' '{printf "%-38s %-26s %-10s %s\n", $1, $2, $3, $4}'
rm -f "$RESULTS"
