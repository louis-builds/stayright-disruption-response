#!/usr/bin/env bash
# 批量处理放在桌面上的开发者公钥：扫描 ~/Desktop 下所有 .pub 文件，
# 挨个调用 add-dev-ssh-key.sh 加进跳板机，全部处理完再问要不要清理桌面。
#
#   ./scripts/onboard-devs-from-desktop.sh
#
# 每个文件的 name 默认取文件名（去掉 .pub 后缀），处理前会一个个列出来
# 让你确认，不会不问就动手。
#
# 不碰数据库密码——密码还是要你自己走 1Password/加密聊天单独发，这个脚本
# 只处理公钥这一步。
set -euo pipefail

DESKTOP="${DESKTOP:-$HOME/Desktop}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADD_KEY_SCRIPT="${SCRIPT_DIR}/add-dev-ssh-key.sh"

[ -f "$ADD_KEY_SCRIPT" ] || { echo "❌ 找不到 $ADD_KEY_SCRIPT"; exit 1; }

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

shopt -s nullglob
PUB_FILES=("$DESKTOP"/*.pub)
shopt -u nullglob

if [ ${#PUB_FILES[@]} -eq 0 ]; then
  echo "桌面（$DESKTOP）上没找到任何 .pub 文件，没什么可处理的。"
  exit 0
fi

say "在桌面找到 ${#PUB_FILES[@]} 个公钥文件："
for f in "${PUB_FILES[@]}"; do
  echo "  - $(basename "$f")"
done

PROCESSED=()
FAILED=()

for f in "${PUB_FILES[@]}"; do
  base="$(basename "$f" .pub)"
  # 文件名可能是 stayright-dev-hongwei.pub 或者就是 hongwei.pub，两种都支持：
  # 去掉可能存在的 stayright-dev- 前缀，剩下的当 name
  name="${base#stayright-dev-}"

  say "处理 ${name}（来自 $(basename "$f")）"
  read -r -p "  用这个名字加进白名单？直接回车确认，或输入别的名字: " CUSTOM_NAME
  [ -n "$CUSTOM_NAME" ] && name="$CUSTOM_NAME"

  if "$ADD_KEY_SCRIPT" "$name" "$f"; then
    PROCESSED+=("$f")
  else
    echo "  ⚠️  ${name} 处理失败或被取消，跳过"
    FAILED+=("$f")
  fi
done

say "处理完成：成功 ${#PROCESSED[@]} 个，失败/跳过 ${#FAILED[@]} 个"

if [ ${#PROCESSED[@]} -gt 0 ]; then
  echo "已成功加进跳板机白名单的文件："
  for f in "${PROCESSED[@]}"; do echo "  - $(basename "$f")"; done
  echo
  read -r -p "要把这 ${#PROCESSED[@]} 个已处理的 .pub 文件从桌面删掉吗？[y/N] " CLEAN
  if [ "$CLEAN" = "y" ]; then
    for f in "${PROCESSED[@]}"; do rm -f "$f"; done
    echo "✅ 已清理"
  else
    echo "保留在桌面，不动。"
  fi
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  echo
  echo "以下文件没处理成功，留在桌面没动，可以单独重跑："
  for f in "${FAILED[@]}"; do echo "  ./scripts/add-dev-ssh-key.sh <name> \"$f\""; done
fi

echo
echo "别忘了：数据库密码还要单独走 1Password/加密聊天发给每个人，这一步脚本不管。"
