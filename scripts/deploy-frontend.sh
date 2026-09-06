#!/usr/bin/env bash
# 前端部署到 S3 + CloudFront 失效。
#
#   ./scripts/deploy-frontend.sh
#
# VITE_API_BASE_URL 置空 → client.ts 走同源相对路径 /api/*，与域名解耦。
# 不用 `aws s3 sync --delete`（8/27 教训：误删过桶里文件）。
# hash 资源 immutable 长缓存；index.html / favicon.svg no-cache（发版即生效）。

set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-2}"
SITE_BUCKET="${SITE_BUCKET:-stayright-dev-site-990393187001}"
CF_DIST_ID="${CF_DIST_ID:-E3CNDKHDSY3D1I}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FE="$REPO_ROOT/frontend"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

say "1. 构建"
( cd "$FE" && VITE_API_BASE_URL="" npm run build )
grep -rl "localhost:50" "$FE/dist" && { echo "❌ 构建产物里有 localhost 残留"; exit 1; } || true

say "2. 上传 S3"
aws s3 sync "$FE/dist/" "s3://$SITE_BUCKET/" --region "$REGION" \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude index.html --exclude favicon.svg
aws s3 cp "$FE/dist/index.html" "s3://$SITE_BUCKET/index.html" --region "$REGION" --cache-control "no-cache"
aws s3 cp "$FE/dist/favicon.svg" "s3://$SITE_BUCKET/favicon.svg" --region "$REGION" --cache-control "no-cache"

say "3. CloudFront 失效"
INV_ID=$(aws cloudfront create-invalidation --distribution-id "$CF_DIST_ID" --paths "/*" \
  --query 'Invalidation.Id' --output text)
echo "invalidation: $INV_ID"

say "✅ 前端部署完成"
echo "验证： curl -s https://d2y6g16anevc6h.cloudfront.net/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\\.js'"
