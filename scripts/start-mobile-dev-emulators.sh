#!/usr/bin/env bash
# 一键拉起 guest-app / hotel-app / coordinator-app 三端的本地测试环境：
# 三台独立 Android 模拟器 + 三个 Metro 开发服务器，各开一个 Terminal 窗口方便看实时日志。
#
#   ./scripts/start-mobile-dev-emulators.sh
#
# 前提（只需要做一次，不是这个脚本管的范围）：
#   - Android Studio 已装，SDK 在 ~/Library/Android/sdk
#   - JDK 17 已装：brew install openjdk@17（Android 原生构建跟系统默认的新版 JDK 不兼容）
#   - 三个虚拟设备已建好：Pixel_10_Pro / Pixel_10_Pro_B / Pixel_10_Pro_C
#     （用 Android Studio 的 Device Manager 建，或者克隆现有 AVD 目录改名，
#     这个脚本不负责建 AVD，只负责启动）
#   - 三个 App 都用 `expo run:android` 完整 build 过一次，
#     即 <app>/android/app/build/outputs/apk/debug/app-debug.apk 已存在
#     （第一次跑这个脚本前，先手动对每个 App 跑一次 expo run:android）
#
# 做的事：
#   1. 检查三台模拟器有没有在跑，没跑的启动起来，等它们完全开机
#   2. 查清楚每台模拟器实际的 adb 设备号（重启后设备号会变，不能硬编码）
#   3. 把已经 build 好的 APK 精确装到对应设备上、配好端口转发、启动对应 App
#      （不走 expo run:android 自带的设备选择逻辑——实测过它在多设备同时在线时
#      经常装错设备，这里全部用 adb -s <serial> 显式指定，参考
#      docs/ARCHITECTURE.md 记录的这次踩坑）
#   4. 用 AppleScript 开 3 个独立 Terminal 窗口，每个窗口跑一个 App 的
#      `expo start --dev-client`，方便分别看三端的实时日志、需要时单独 Ctrl+C
#
# 兼容性说明：macOS 自带 /bin/bash 是 3.2（没有关联数组，那是 bash 4+ 才有），
# 这个脚本刻意只用普通索引数组，三个数组下标对齐（AVDS[i]/APPS[i]/... 说的是
# 同一台设备），不要求装新版 bash。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

CLOUDFRONT_URL="https://d1s582gz77wdm.cloudfront.net"

# 三个数组下标一一对应，i=0 是 guest-app，i=1 是 hotel-app，i=2 是 coordinator-app
AVDS=(Pixel_10_Pro Pixel_10_Pro_B Pixel_10_Pro_C)
APPS=(guest-app hotel-app coordinator-app)
PKGS=(nz.stayright.guest com.stayright.hotelapp nz.stayright.coordinator)
PORTS=(8081 8082 8083)
SERIALS=("" "" "")  # 运行时填充

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

for AVD in "${AVDS[@]}"; do
  [ -d "$HOME/.android/avd/${AVD}.avd" ] || { echo "❌ 找不到虚拟设备 ${AVD}，先用 Android Studio 的 Device Manager 建好三个（Pixel_10_Pro / _B / _C）再跑这个脚本"; exit 1; }
done

# 查一遍当前在线设备，填充 SERIALS[i]（按 avd 名字匹配，不是按启动顺序，
# 因为模拟器每次重开设备号都可能变）
refresh_serials() {
  local line serial state name i
  while IFS=$'\t' read -r serial state; do
    [ "$state" = "device" ] || continue
    name=$(adb -s "$serial" shell getprop ro.boot.qemu.avd_name < /dev/null 2>/dev/null | tr -d '\r')
    [ -z "$name" ] && continue
    for i in 0 1 2; do
      if [ "${AVDS[$i]}" = "$name" ]; then SERIALS[$i]="$serial"; fi
    done
  done < <(adb devices | tail -n +2)
}

say "1. 检查三台模拟器状态"
refresh_serials
for i in 0 1 2; do
  if [ -n "${SERIALS[$i]}" ]; then
    echo "  ${AVDS[$i]}: 已在跑 (${SERIALS[$i]})"
  else
    echo "  ${AVDS[$i]}: 没在跑，启动中..."
    nohup "$ANDROID_HOME/emulator/emulator" -avd "${AVDS[$i]}" -no-snapshot \
      > "/tmp/${AVDS[$i]}-emulator.log" 2>&1 &
    disown
  fi
done

say "2. 等所有模拟器开机完成"
while true; do
  refresh_serials
  all_up=1
  for i in 0 1 2; do
    if [ -z "${SERIALS[$i]}" ]; then all_up=0; continue; fi
    booted=$(adb -s "${SERIALS[$i]}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    [ "$booted" = "1" ] || all_up=0
  done
  [ "$all_up" = "1" ] && break
  sleep 3
done
echo "  三台都开机完成："
for i in 0 1 2; do
  echo "    ${AVDS[$i]} → ${SERIALS[$i]}"
done

say "3. 精确安装 + 启动每个 App（显式指定设备，不用 expo 自动选设备）"
for i in 0 1 2; do
  serial="${SERIALS[$i]}"
  app="${APPS[$i]}"
  pkg="${PKGS[$i]}"
  port="${PORTS[$i]}"
  apk="${REPO_ROOT}/${app}/android/app/build/outputs/apk/debug/app-debug.apk"

  if [ ! -f "$apk" ]; then
    echo "  ⚠️  ${app} 还没 build 过（找不到 ${apk}），跳过安装——先手动跑一次:"
    echo "      cd ${app} && ANDROID_SERIAL=${serial} EXPO_PUBLIC_API_BASE_URL=${CLOUDFRONT_URL} npx expo run:android --port ${port}"
    continue
  fi

  adb -s "$serial" reverse "tcp:${port}" "tcp:${port}" >/dev/null
  adb -s "$serial" install -r "$apk" >/dev/null
  adb -s "$serial" shell am start -n "${pkg}/.MainActivity" >/dev/null
  echo "  ${app} → ${serial} (端口 ${port}) 已装好并启动"
done

say "4. 分别开 3 个 Terminal 窗口跑各自的 Metro 服务器"
for i in 0 1 2; do
  serial="${SERIALS[$i]}"
  app="${APPS[$i]}"
  port="${PORTS[$i]}"
  CMD="cd '${REPO_ROOT}/${app}' && export ANDROID_HOME='${ANDROID_HOME}' JAVA_HOME='${JAVA_HOME}' PATH='${JAVA_HOME}/bin:${ANDROID_HOME}/platform-tools:${ANDROID_HOME}/emulator:\$PATH' ANDROID_SERIAL='${serial}' && echo '== ${app} on ${serial} (port ${port}) ==' && EXPO_PUBLIC_API_BASE_URL=${CLOUDFRONT_URL} npx expo start --dev-client --port ${port}"
  osascript -e "tell application \"Terminal\" to do script \"${CMD//\"/\\\"}\""
done

cat <<EOF

========================================
✅ 三端都拉起来了：
  ${APPS[0]}  → ${SERIALS[0]}  (Metro :${PORTS[0]})
  ${APPS[1]}  → ${SERIALS[1]}  (Metro :${PORTS[1]})
  ${APPS[2]}  → ${SERIALS[2]}  (Metro :${PORTS[2]})

3 个 Terminal 窗口已经开好，各自跑着对应 App 的 Metro，实时日志直接看那边。
要停掉某一个：切到对应窗口 Ctrl+C 即可，不影响另外两个。
========================================
EOF
