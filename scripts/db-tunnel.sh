#!/usr/bin/env bash
# 保活的数据库 SSM 隧道：把线上 EC2 上的 Postgres（容器 pg:5432）转发到
# 本机 127.0.0.1:15432，断了自动重连，并用 keepalive 流量顶掉 SSM 的空闲超时。
#
# 手动跑（前台，Ctrl+C 结束）：
#   scripts/db-tunnel.sh
# 开机常驻：scripts/db-tunnel-install.sh 装成 launchd 服务。
#
# 依赖：aws CLI v2 + session-manager-plugin + 有效凭证（ssm:StartSession 权限）。
# 前置：SSM 空闲超时建议提到 60 分钟，见 docs/DATABASE_ACCESS.md §3.2。
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
EC2_ID="${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID (no cross-account default — see docs/DATABASE_ACCESS.md)}"
LOCAL_PORT="${DB_TUNNEL_LOCAL_PORT:-15432}"
REMOTE_PORT="${DB_TUNNEL_REMOTE_PORT:-5432}"
KEEPALIVE_SECS="${DB_TUNNEL_KEEPALIVE_SECS:-20}"
AWS_PROFILE_ARG=()
[ -n "${AWS_PROFILE:-}" ] && AWS_PROFILE_ARG=(--profile "$AWS_PROFILE")

log() { printf '%s db-tunnel: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }

command -v aws >/dev/null || { log "aws CLI 未安装"; exit 127; }
command -v session-manager-plugin >/dev/null || { log "session-manager-plugin 未安装"; exit 127; }

# 单实例锁：已经有一个本脚本在跑就退出，避免叠两个。
LOCKDIR="${TMPDIR:-/tmp}/stayright-db-tunnel-${LOCAL_PORT}.lock"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  if [ -f "$LOCKDIR/pid" ] && kill -0 "$(cat "$LOCKDIR/pid" 2>/dev/null)" 2>/dev/null; then
    log "已有一个 db-tunnel 在跑（pid $(cat "$LOCKDIR/pid")），退出。"
    exit 0
  fi
  rmdir "$LOCKDIR" 2>/dev/null || true
  mkdir "$LOCKDIR" 2>/dev/null || { log "抢锁失败，退出。"; exit 0; }
fi
echo $$ > "$LOCKDIR/pid"

# 端口被占用：拿到锁还占着，多半是上一轮 session-manager-plugin 残留的孤儿进程，
# 会一直占着端口让新 session 起不来。按端口找到它杀掉。
if nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
  # 只杀监听端口的进程（残留的 plugin），不碰连到这个端口的客户端（比如正在跑的后端）。
  listener="$(lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$listener" ]; then
    log "端口 $LOCAL_PORT 有残留监听进程（pid: $listener），回收"
    kill $listener 2>/dev/null || true
    for _ in $(seq 1 10); do nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null || break; sleep 1; done
  fi
fi

KEEPALIVE_PID=""
SESSION_PID=""
cleanup() {
  trap - TERM INT EXIT
  [ -n "$KEEPALIVE_PID" ] && kill "$KEEPALIVE_PID" 2>/dev/null || true
  [ -n "$SESSION_PID" ] && kill "$SESSION_PID" 2>/dev/null || true
  rm -rf "$LOCKDIR" 2>/dev/null || true
  log "已停止"
}
trap cleanup TERM INT EXIT

# keepalive：每 N 秒对本地端口发一个真实的 Postgres SSLRequest 并读回一字节，
# 让隧道上始终有数据流动，SSM 的空闲超时（默认 20 分钟）就不会触发。
keepalive_loop() {
  local py="${PYTHON:-python3}"
  while true; do
    "$py" - "$LOCAL_PORT" <<'PY' 2>/dev/null || true
import socket, struct, sys
port = int(sys.argv[1])
try:
    s = socket.create_connection(("127.0.0.1", port), timeout=3)
    s.sendall(struct.pack("!ii", 8, 80877103))  # PostgreSQL SSLRequest
    s.recv(1)
    s.close()
except OSError:
    pass
PY
    sleep "$KEEPALIVE_SECS"
  done
}
keepalive_loop &
KEEPALIVE_PID=$!

backoff=2
while true; do
  log "连接 $EC2_ID  ($REGION)  127.0.0.1:$LOCAL_PORT -> :$REMOTE_PORT"
  set +e
  aws ssm start-session "${AWS_PROFILE_ARG[@]}" --region "$REGION" --target "$EC2_ID" \
    --document-name AWS-StartPortForwardingSession \
    --parameters "{\"portNumber\":[\"$REMOTE_PORT\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}" &
  SESSION_PID=$!
  wait "$SESSION_PID"
  rc=$?
  set -e
  SESSION_PID=""
  log "隧道退出（rc=$rc），${backoff}s 后重连"
  sleep "$backoff"
  backoff=$(( backoff < 30 ? backoff * 2 : 30 ))
done
