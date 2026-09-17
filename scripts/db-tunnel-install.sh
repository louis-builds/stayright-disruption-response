#!/usr/bin/env bash
# 把 scripts/db-tunnel.sh 装成 macOS launchd 用户服务：登录即起、崩溃自动拉起、
# 断线自动重连。装完隧道就一直在 127.0.0.1:15432 待命。
#
#   scripts/db-tunnel-install.sh            # 安装并启动
#   scripts/db-tunnel-install.sh uninstall  # 卸载
#
# 需要指定实例：环境变量 EC2_INSTANCE_ID（无默认值，必须显式传入，避免装到错账户的实例上）。
# 用命名 profile 的话再传 AWS_PROFILE。
set -euo pipefail

LABEL="com.stayright.db-tunnel"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TUNNEL="$REPO/scripts/db-tunnel.sh"
LOG="$HOME/Library/Logs/stayright-db-tunnel.log"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载 $LABEL"
  exit 0
fi

: "${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID (no cross-account default — see docs/DATABASE_ACCESS.md)}"

command -v aws >/dev/null || { echo "aws CLI 未安装"; exit 127; }
command -v session-manager-plugin >/dev/null || { echo "session-manager-plugin 未安装"; exit 127; }
# keepalive 只用标准库，任意 python3 都行；优先系统自带那个（不依赖 venv）。
PY="/usr/bin/python3"; [ -x "$PY" ] || PY="$(command -v python3 || true)"
[ -n "$PY" ] || { echo "python3 未找到（keepalive 需要）"; exit 127; }
chmod +x "$TUNNEL"

# launchd 的 PATH 很干净，要把工具所在目录显式带上。
TOOLS_PATH="$(dirname "$(command -v aws)"):$(dirname "$(command -v session-manager-plugin)"):$(dirname "$PY")"
FULL_PATH="$TOOLS_PATH:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$TUNNEL</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>RunAtLoad</key><true/>
  <!-- 正常情况下脚本永不退出；只在异常退出时重新拉起，干净退出（例如已有实例）不churn。 -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$FULL_PATH</string>
    <key>PYTHON</key><string>$PY</string>
    <key>AWS_REGION</key><string>${AWS_REGION:-ap-southeast-2}</string>
    <key>EC2_INSTANCE_ID</key><string>${EC2_INSTANCE_ID}</string>
$( [ -n "${AWS_PROFILE:-}" ] && printf '    <key>AWS_PROFILE</key><string>%s</string>\n' "$AWS_PROFILE" )
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "已安装并启动 $LABEL"
echo "  日志： tail -f $LOG"
echo "  状态： launchctl print gui/$(id -u)/$LABEL | grep -E 'state|pid'"
echo "  卸载： scripts/db-tunnel-install.sh uninstall"
echo
echo "等几秒验证："
echo "  nc -z 127.0.0.1 15432 && echo OK"
