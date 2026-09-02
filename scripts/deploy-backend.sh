#!/usr/bin/env bash
# 后端（C# API）部署到 EC2。
#
#   ./scripts/deploy-backend.sh
#
# 流程（对应 AWS-Deployment-History.md 的 B1 线，原子换目录）：
#   1. dotnet publish（linux-x64 / self-contained / net9.0）
#   2. 打 tar.gz，上传 s3://<RAW_BUCKET>/deploy/
#   3. 生成预签名下载 URL（EC2 无需 S3 读权限）
#   4. SSM RunCommand 到 EC2：下载 → 解压到 api.new → stop → api→api.old → api.new→api → start
#   5. 轮询命令结果 + 校验服务 active + 本机探活
#
# 不碰 /opt/stayright/.env（Gmail 发件人、GEMINI/Bedrock key 等都在里面）。
# 迁移在服务启动时由 Program.cs 的 db.Database.MigrateAsync() 自动应用。
#
# 前置：本机有 dotnet SDK、AWS 凭证（s3 / ssm send-command / ssm get-command-invocation）。
# 回滚：EC2 上 `sudo systemctl stop stayright-api && sudo rm -rf /opt/stayright/api \
#        && sudo mv /opt/stayright/api.old /opt/stayright/api && sudo systemctl start stayright-api`

set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
EC2_ID="${EC2_INSTANCE_ID:-i-0d71260ab44ceb0c3}"
RAW_BUCKET="${RAW_BUCKET:-stayright-dev-raw-990393187001}"
API_PORT="${API_PORT:-5080}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CSPROJ="$REPO_ROOT/backend/TravelDisruptionAgent.Api.csproj"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$REPO_ROOT/backend/publish-out"
TARBALL="/tmp/stayright-api-$STAMP.tar.gz"
S3_KEY="deploy/stayright-api-$STAMP.tar.gz"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

say "1. dotnet publish"
rm -rf "$OUT_DIR"
dotnet publish "$CSPROJ" -c Release -r linux-x64 --self-contained \
  -o "$OUT_DIR" --property:TargetFramework=net9.0
# 8/27 教训：Web SDK 默认只拷 *.json，rag 种子 .md 靠 csproj 显式 <Content Include> 带上
test -f "$OUT_DIR/SeedData/rag/常见问题.md" || { echo "❌ rag 种子文件没打进包"; exit 1; }

say "2. 打包 + 上传 S3"
tar -C "$OUT_DIR" -czf "$TARBALL" .
ls -lh "$TARBALL"
aws s3 cp "$TARBALL" "s3://$RAW_BUCKET/$S3_KEY" --region "$REGION"

say "3. 预签名 URL"
URL="$(aws s3 presign "s3://$RAW_BUCKET/$S3_KEY" --region "$REGION" --expires-in 1800)"

say "4. SSM RunCommand：原子换目录"
REMOTE=$(cat <<REMOTE_EOF
set -e
curl -fsSL "$URL" -o /tmp/api-$STAMP.tar.gz
sudo rm -rf /opt/stayright/api.new
sudo mkdir -p /opt/stayright/api.new
sudo tar -xzf /tmp/api-$STAMP.tar.gz -C /opt/stayright/api.new
sudo chmod +x /opt/stayright/api.new/TravelDisruptionAgent.Api
sudo systemctl stop stayright-api
sudo rm -rf /opt/stayright/api.old
if [ -d /opt/stayright/api ]; then sudo mv /opt/stayright/api /opt/stayright/api.old; fi
sudo mv /opt/stayright/api.new /opt/stayright/api
sudo systemctl start stayright-api
sleep 6
systemctl is-active stayright-api
curl -s -o /dev/null -w "local /api/auth/me -> %{http_code} (403=ok)\n" http://localhost:$API_PORT/api/auth/me
sudo journalctl -u stayright-api --since "1 min ago" --no-pager | grep -iE "migrat|Now listening|Application started|error" | tail -15
rm -f /tmp/api-$STAMP.tar.gz
REMOTE_EOF
)
B64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')
CMD_ID=$(aws ssm send-command --region "$REGION" --instance-ids "$EC2_ID" \
  --document-name AWS-RunShellScript --comment "deploy backend $STAMP" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query 'Command.CommandId' --output text)
echo "command id: $CMD_ID"

say "5. 轮询结果"
for _ in $(seq 1 40); do
  ST=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" \
    --instance-id "$EC2_ID" --query Status --output text 2>/dev/null || echo Pending)
  [ "$ST" != "InProgress" ] && [ "$ST" != "Pending" ] && break
  sleep 3
done
echo "--- stdout ---"
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$EC2_ID" \
  --query StandardOutputContent --output text
if [ "$ST" != "Success" ]; then
  echo "--- stderr ---"
  aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$EC2_ID" \
    --query StandardErrorContent --output text
  echo "❌ 部署失败（状态 $ST）。回滚见脚本头部注释。"
  exit 1
fi

rm -f "$TARBALL"
say "✅ 后端部署完成（$STAMP）"
echo "公网验证： curl -s -o /dev/null -w '%{http_code}\\n' https://d2y6g16anevc6h.cloudfront.net/api/auth/me   # 期望 403"
