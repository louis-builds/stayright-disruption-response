#!/usr/bin/env bash
# 一键起项目：数据库隧道 + 后端 + 前端，三者生命周期绑在一起。
#
#   scripts/dev.sh              # 全起
#   scripts/dev.sh backend      # 只起隧道 + 后端
#   scripts/dev.sh frontend     # 只起前端（不碰隧道/后端）
#
# Ctrl+C 一次性停掉本次起的所有进程（隧道也一并关闭）——
# 不再用 launchd 常驻服务开机自动连 EC2，隧道只在跑本项目时才连着。
#
# 依赖：scripts/db-tunnel.sh 同目录下的 aws CLI + session-manager-plugin；
# 后端需要 backend/../.env（见 .env.example）。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

MODE="${1:-all}"
LOCAL_PORT="${DB_TUNNEL_LOCAL_PORT:-15432}"

log() { printf '%s dev: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; }

TUNNEL_PID=""
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - INT TERM EXIT
  log "关闭中..."
  for pid in "$FRONTEND_PID" "$BACKEND_PID" "$TUNNEL_PID"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  # session-manager-plugin 是 aws ssm 的孙进程，有时不随父进程一起退出，
  # 兜底按端口把监听方杀掉，避免隧道进程残留占着 15432。
  local leftover
  leftover="$(lsof -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN -t 2>/dev/null || true)"
  [ -n "$leftover" ] && { log "清理残留的隧道监听进程: $leftover"; kill -9 $leftover 2>/dev/null || true; }
  log "已全部停止"
}
trap cleanup INT TERM EXIT

start_tunnel() {
  log "启动数据库隧道 (127.0.0.1:$LOCAL_PORT)..."
  scripts/db-tunnel.sh &
  TUNNEL_PID=$!
  for _ in $(seq 1 30); do
    nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null && { log "隧道就绪"; return; }
    kill -0 "$TUNNEL_PID" 2>/dev/null || { log "隧道进程提前退出，看上面的报错"; exit 1; }
    sleep 1
  done
  log "隧道 30s 内未就绪，继续往下起（后端连库会自己报错）"
}

start_backend() {
  log "启动后端 (dotnet run)..."
  (
    cd backend
    set -a; [ -f ../.env ] && source ../.env; set +a
    exec dotnet run
  ) &
  BACKEND_PID=$!
}

start_frontend() {
  log "启动前端 (npm run dev)..."
  ( cd frontend && exec npm run dev ) &
  FRONTEND_PID=$!
}

case "$MODE" in
  all)
    start_tunnel
    start_backend
    start_frontend
    ;;
  backend)
    start_tunnel
    start_backend
    ;;
  frontend)
    start_frontend
    ;;
  *)
    echo "用法: scripts/dev.sh [all|backend|frontend]" >&2
    exit 1
    ;;
esac

wait
