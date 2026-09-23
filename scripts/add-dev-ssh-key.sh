#!/usr/bin/env bash
# 给团队成员开通"仅转发到 RDS"的跳板机访问权限（OS 级 SSH key 管理，不需要任何
# IAM 权限——这个账户的登录身份对 IAM 彻底锁死是课程侧永久边界，团队直连走的
# 是"EC2 跳板机 + SSH key，Zachary 手动管理"这条已确认方案，不是走 IAM User）。
#
# 用法：
#   ./scripts/add-dev-ssh-key.sh <name> <path-to-their-public-key.pub>
#
# 例：
#   ./scripts/add-dev-ssh-key.sh hongwei ~/Downloads/hongwei_id_ed25519.pub
#
# 做的事：
#   1. SSH 到跳板机（用你自己的 stayright-prod-bastion-key.pem）
#   2. 把对方的公钥追加进 ec2-user 的 authorized_keys，但加上限制前缀：
#      - permitopen="<RDS host>:5432"  这把 key 只能转发到 RDS 的 5432 端口，
#        转发到其他任何地址/端口都会被拒绝
#      - no-pty / no-agent-forwarding / no-X11-forwarding / command="..."
#        堵死交互式 shell —— 即使私钥泄露，攻击者也登不进 EC2、跑不了命令，
#        只能建一条到 RDS:5432 的隧道
#   3. 打印这条 key 对应开发者本地要跑的隧道命令，方便你直接转发给对方
#
# 不做的事：不碰 IAM、不碰安全组（22 端口本来就对 0.0.0.0/0 开放，只靠 key
# 认证防护，见 docs/AWS_SDK_SPEC.md §8.1）、不分发数据库密码——密码走单独的
# 安全渠道（1Password/加密聊天等）发给团队，不要写进这个脚本或任何仓库文件。
set -euo pipefail

NAME="${1:?用法: ./scripts/add-dev-ssh-key.sh <name> <path-to-public-key.pub>}"
PUBKEY_FILE="${2:?用法: ./scripts/add-dev-ssh-key.sh <name> <path-to-public-key.pub>}"

BASTION_HOST="${BASTION_HOST:-3.105.155.148}"
BASTION_USER="${BASTION_USER:-ec2-user}"
BASTION_KEY="${BASTION_KEY:-$HOME/.ssh/stayright-prod-bastion-key.pem}"
RDS_HOST="${RDS_HOST:-stayright-prod-db.cpua0yc0ue7o.ap-southeast-2.rds.amazonaws.com}"

[[ "$NAME" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "❌ name 只能是字母数字下划线短横线（会写进 authorized_keys 的注释里）"; exit 1; }
[ -f "$PUBKEY_FILE" ] || { echo "❌ 找不到公钥文件: $PUBKEY_FILE"; exit 1; }
[ -f "$BASTION_KEY" ] || { echo "❌ 找不到你自己的跳板机私钥: $BASTION_KEY"; exit 1; }

PUBKEY=$(cat "$PUBKEY_FILE")
# 公钥格式粗校验：ssh-ed25519/ssh-rsa/ecdsa-... 开头，不能是私钥文件
case "$PUBKEY" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-sha2-*\ *) ;;
  *) echo "❌ 这文件看起来不是一个 SSH 公钥（应该以 ssh-ed25519/ssh-rsa 开头）：$PUBKEY_FILE"; exit 1 ;;
esac

RESTRICTED_LINE="command=\"echo 'Port-forwarding only. Contact Zachary if you need shell access.'\",no-pty,no-agent-forwarding,no-X11-forwarding,no-user-rc,permitopen=\"${RDS_HOST}:5432\" ${PUBKEY} stayright-dev-${NAME}"

echo "▸ 将要追加到跳板机 ~/.ssh/authorized_keys 的一行（仅可转发到 ${RDS_HOST}:5432，无 shell）："
echo
echo "  command=\"...\",no-pty,...,permitopen=\"${RDS_HOST}:5432\" ssh-... stayright-dev-${NAME}"
echo

read -r -p "确认追加？[y/N] " CONFIRM
[ "$CONFIRM" = "y" ] || { echo "已取消"; exit 0; }

# 用 grep 幂等检查：同一个 name 标签已存在就不重复加
ssh -i "$BASTION_KEY" "${BASTION_USER}@${BASTION_HOST}" bash -s <<EOF
set -euo pipefail
mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
if grep -q "stayright-dev-${NAME}\$" ~/.ssh/authorized_keys 2>/dev/null; then
  echo "⚠️  已经有一条 stayright-dev-${NAME} 的记录了，跳过（如需换 key 先手动删旧行）"
else
  echo '${RESTRICTED_LINE}' >> ~/.ssh/authorized_keys
  echo "✅ 已追加"
fi
EOF

cat <<MSG

========================================
✅ 完成。把下面这段发给 ${NAME}（把 <私钥路径> 换成他们自己生成密钥时的路径）：
----------------------------------------
ssh -i <私钥路径> -f -N \\
  -L 15432:${RDS_HOST}:5432 \\
  ${BASTION_USER}@${BASTION_HOST}

之后本地 .env 里 PGHOST/POSTGRES_HOST 填 127.0.0.1，端口 15432。
数据库密码另外用安全渠道发，不要放 Slack 明文/仓库。
----------------------------------------
撤销权限：SSH 上跳板机，从 ~/.ssh/authorized_keys 里删掉
"stayright-dev-${NAME}" 那一行即可，不需要动 IAM/安全组。
========================================
MSG
