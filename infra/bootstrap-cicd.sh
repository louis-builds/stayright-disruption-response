#!/usr/bin/env bash
# 一次性搭建 CI/CD：CodeStar Connection（GitHub）+ IAM 角色 + CodeBuild 项目
# （gate / gate-pr / deploy-backend / deploy-frontend）+ CodePipeline。
#
# 背景：这个仓库所在的 GitHub 组织把 Actions 的 allowed_actions 限制成
# `local_only`——只允许本仓库内定义的 action，任何 `actions/*`（checkout /
# setup-python / setup-node / setup-dotnet）都不放行，.github/workflows/gate.yml
# 每次触发都是 startup_failure。这个策略在组织层强制、repo 层改不了
# （2026-09-09 Zachary 拍板：不再等组织放开，CI/CD 全部走 AWS）。
# .github/workflows/gate.yml 已随这次决策删除。
#
# 这个脚本做的事全部可逆（IAM 角色 / CodeBuild 项目 / webhook / CodePipeline
# 都能用对应的 `aws ... delete-*` 撤掉），不改动任何现有资源
# （EC2/S3/CloudFront/SAM 栈原样不动）。
#
# 跑完这个脚本后，唯一需要你去 AWS 控制台手动点一下的步骤：
#   CodeStar Connection 建出来时状态是 PENDING，必须在控制台完成一次
#   GitHub OAuth 授权握手才会变 AVAILABLE——这一步 AWS 出于安全设计不允许
#   纯 CLI 完成，脚本跑完会打印控制台链接。
#
# 分支模型与触发（2026-09-09 Zachary 拍板）：
#   开发分支 --PR--> Test（集成） --PR--> main（发布）
#   - PR 进 Test / main    → CodeBuild `stayright-gate-pr` 经 GitHub webhook 跑
#                            gate，结果回写 PR 的 commit status（合并前拦截）
#   - 提交进 main（合并后） → CodePipeline 自动跑：Gate → 人工审批 → 部署
#                            （DetectChanges=true，盯 main 分支）
#   Test 分支自身不触发部署——只有 PR gate。部署只从 main 出。
#
# 用法：ACCOUNT_ID=... RAW_BUCKET=... SITE_BUCKET=... CF_DIST_ID=... EC2_INSTANCE_ID=... ./infra/bootstrap-cicd.sh
#
# 这五个值是账户/环境专属的资源标识，没有默认值——每次在新 AWS 账户（如课程
# 分配的新账户）里跑，都必须显式传入目标账户自己的值，防止漏传时误用上一次
# 跑过的账户的值，把 IAM 策略/资源授权指向错误账户。

set -euo pipefail

REGION="ap-southeast-2"
ACCOUNT_ID="${ACCOUNT_ID:?Set ACCOUNT_ID to the target AWS account (no cross-account default)}"
RAW_BUCKET="${RAW_BUCKET:?Set RAW_BUCKET (no cross-account default)}"
SITE_BUCKET="${SITE_BUCKET:?Set SITE_BUCKET (no cross-account default)}"
CF_DIST_ID="${CF_DIST_ID:?Set CF_DIST_ID (no cross-account default)}"
EC2_INSTANCE_ID="${EC2_INSTANCE_ID:?Set EC2_INSTANCE_ID (no cross-account default)}"
GITHUB_OWNER="${GITHUB_OWNER:-CS778-S2-2026-AWS-Challenge}"
GITHUB_REPO="${GITHUB_REPO:-Kakapo}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"                 # pipeline 盯的分支：合并进 main 即触发部署流程
PR_GATE_BASE_REFS="${PR_GATE_BASE_REFS:-^refs/heads/(Test|main)$}"   # PR gate webhook 覆盖的目标分支
CONNECTION_NAME="${CONNECTION_NAME:-stayright-github}"
PIPELINE_ARTIFACT_PREFIX="${PIPELINE_ARTIFACT_PREFIX:-codepipeline-artifacts}"

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
say "1. CodeStar Connection（GitHub）—— 若已存在则复用"
# ---------------------------------------------------------------------------
CONNECTION_ARN=$(aws codestar-connections list-connections --region "$REGION" \
  --query "Connections[?ConnectionName=='$CONNECTION_NAME'].ConnectionArn | [0]" --output text)

if [ "$CONNECTION_ARN" == "None" ] || [ -z "$CONNECTION_ARN" ]; then
  CONNECTION_ARN=$(aws codestar-connections create-connection --region "$REGION" \
    --provider-type GitHub --connection-name "$CONNECTION_NAME" \
    --query ConnectionArn --output text)
  echo "已创建 connection: $CONNECTION_ARN"
else
  echo "已存在，复用: $CONNECTION_ARN"
fi

CONN_STATUS=$(aws codestar-connections get-connection --connection-arn "$CONNECTION_ARN" \
  --query 'Connection.ConnectionStatus' --output text)
echo "connection 状态: $CONN_STATUS"

# ---------------------------------------------------------------------------
say "2. IAM 角色：CodeBuild 通用部署角色（gate / deploy-backend / deploy-frontend 共用）"
# ---------------------------------------------------------------------------
CODEBUILD_ROLE_NAME="stayright-codebuild-deploy-role"

cat > /tmp/codebuild-trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "codebuild.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

if ! aws iam get-role --role-name "$CODEBUILD_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$CODEBUILD_ROLE_NAME" \
    --assume-role-policy-document file:///tmp/codebuild-trust-policy.json >/dev/null
  echo "已创建角色 $CODEBUILD_ROLE_NAME"
else
  echo "角色 $CODEBUILD_ROLE_NAME 已存在，复用"
fi

cat > /tmp/codebuild-deploy-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:$REGION:$ACCOUNT_ID:log-group:/aws/codebuild/stayright-*"
    },
    {
      "Sid": "PipelineArtifacts",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"],
      "Resource": "arn:aws:s3:::$RAW_BUCKET/$PIPELINE_ARTIFACT_PREFIX/*"
    },
    {
      "Sid": "RawBucketDeploy",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::$RAW_BUCKET/deploy/*"
    },
    {
      "Sid": "SiteBucketFrontendDeploy",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::$SITE_BUCKET",
        "arn:aws:s3:::$SITE_BUCKET/*"
      ]
    },
    {
      "Sid": "CloudFrontInvalidate",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation"],
      "Resource": "arn:aws:cloudfront::$ACCOUNT_ID:distribution/$CF_DIST_ID"
    },
    {
      "Sid": "SsmRunCommandOnApiInstance",
      "Effect": "Allow",
      "Action": ["ssm:SendCommand"],
      "Resource": [
        "arn:aws:ec2:$REGION:$ACCOUNT_ID:instance/$EC2_INSTANCE_ID",
        "arn:aws:ssm:$REGION::document/AWS-RunShellScript"
      ]
    },
    {
      "Sid": "SsmCommandStatus",
      "Effect": "Allow",
      "Action": ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"],
      "Resource": "*"
    },
    {
      "Sid": "GitHubConnectionForPrGate",
      "Effect": "Allow",
      "Action": [
        "codestar-connections:UseConnection",
        "codeconnections:UseConnection",
        "codeconnections:GetConnectionToken"
      ],
      "Resource": "$CONNECTION_ARN"
    }
  ]
}
EOF

aws iam put-role-policy --role-name "$CODEBUILD_ROLE_NAME" \
  --policy-name stayright-codebuild-deploy-inline \
  --policy-document file:///tmp/codebuild-deploy-policy.json
echo "策略已写入 $CODEBUILD_ROLE_NAME"

CODEBUILD_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$CODEBUILD_ROLE_NAME"

# ---------------------------------------------------------------------------
say "3. IAM 角色：CodePipeline 服务角色"
# ---------------------------------------------------------------------------
PIPELINE_ROLE_NAME="stayright-codepipeline-role"

cat > /tmp/codepipeline-trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "codepipeline.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
EOF

if ! aws iam get-role --role-name "$PIPELINE_ROLE_NAME" >/dev/null 2>&1; then
  aws iam create-role --role-name "$PIPELINE_ROLE_NAME" \
    --assume-role-policy-document file:///tmp/codepipeline-trust-policy.json >/dev/null
  echo "已创建角色 $PIPELINE_ROLE_NAME"
else
  echo "角色 $PIPELINE_ROLE_NAME 已存在，复用"
fi

cat > /tmp/codepipeline-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ArtifactBucket",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:GetBucketVersioning"],
      "Resource": [
        "arn:aws:s3:::$RAW_BUCKET",
        "arn:aws:s3:::$RAW_BUCKET/$PIPELINE_ARTIFACT_PREFIX/*"
      ]
    },
    {
      "Sid": "GitHubConnection",
      "Effect": "Allow",
      "Action": ["codestar-connections:UseConnection"],
      "Resource": "$CONNECTION_ARN"
    },
    {
      "Sid": "RunCodeBuild",
      "Effect": "Allow",
      "Action": ["codebuild:BatchGetBuilds", "codebuild:StartBuild"],
      "Resource": "arn:aws:codebuild:$REGION:$ACCOUNT_ID:project/stayright-*"
    }
  ]
}
EOF

aws iam put-role-policy --role-name "$PIPELINE_ROLE_NAME" \
  --policy-name stayright-codepipeline-inline \
  --policy-document file:///tmp/codepipeline-policy.json
echo "策略已写入 $PIPELINE_ROLE_NAME"

PIPELINE_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$PIPELINE_ROLE_NAME"

# ---------------------------------------------------------------------------
say "4. CodeBuild 项目：gate / deploy-backend / deploy-frontend"
# ---------------------------------------------------------------------------
create_or_update_project() {
  local name="$1" buildspec="$2"
  if aws codebuild batch-get-projects --names "$name" --query 'projects[0].name' --output text 2>/dev/null | grep -q "$name"; then
    echo "项目 $name 已存在，更新 buildspec 路径"
    aws codebuild update-project --name "$name" \
      --source "type=CODEPIPELINE,buildspec=$buildspec" >/dev/null
  else
    aws codebuild create-project --name "$name" \
      --source "type=CODEPIPELINE,buildspec=$buildspec" \
      --artifacts "type=CODEPIPELINE" \
      --environment "type=LINUX_CONTAINER,image=aws/codebuild/standard:7.0,computeType=BUILD_GENERAL1_SMALL" \
      --service-role "$CODEBUILD_ROLE_ARN" \
      --region "$REGION" >/dev/null
    echo "已创建项目 $name"
  fi
}

create_or_update_project "stayright-gate" ".codebuild/buildspec-gate.yml"
create_or_update_project "stayright-deploy-backend" ".codebuild/buildspec-deploy-backend.yml"
create_or_update_project "stayright-deploy-frontend" ".codebuild/buildspec-deploy-frontend.yml"

# ---------------------------------------------------------------------------
say "4b. CodeBuild 项目 stayright-gate-pr —— PR 阶段 gate（GitHub webhook 触发）"
# ---------------------------------------------------------------------------
# 与 stayright-gate 同一套 buildspec，区别是 source 直接连 GitHub（走同一个
# CodeStar/CodeConnections 连接），不经过 CodePipeline。webhook 只对「PR 目标
# 分支是 Test 或 main」的 PR 事件触发；reportBuildStatus=true 把结果回写成
# 该 commit 的 GitHub status，PR 页面能直接看到通过/失败。
GATE_PR_SOURCE="type=GITHUB,location=https://github.com/$GITHUB_OWNER/$GITHUB_REPO.git,buildspec=.codebuild/buildspec-gate.yml,reportBuildStatus=true,auth={type=CODECONNECTIONS,resource=$CONNECTION_ARN}"

if aws codebuild batch-get-projects --names stayright-gate-pr --query 'projects[0].name' --output text 2>/dev/null | grep -q stayright-gate-pr; then
  echo "项目 stayright-gate-pr 已存在，更新 source"
  aws codebuild update-project --name stayright-gate-pr \
    --source "$GATE_PR_SOURCE" \
    --artifacts "type=NO_ARTIFACTS" \
    --environment "type=LINUX_CONTAINER,image=aws/codebuild/standard:7.0,computeType=BUILD_GENERAL1_SMALL" \
    --service-role "$CODEBUILD_ROLE_ARN" --region "$REGION" >/dev/null
else
  aws codebuild create-project --name stayright-gate-pr \
    --source "$GATE_PR_SOURCE" \
    --artifacts "type=NO_ARTIFACTS" \
    --environment "type=LINUX_CONTAINER,image=aws/codebuild/standard:7.0,computeType=BUILD_GENERAL1_SMALL" \
    --service-role "$CODEBUILD_ROLE_ARN" --region "$REGION" >/dev/null
  echo "已创建项目 stayright-gate-pr"
fi

# webhook：PR 打开/更新/重开，且目标分支匹配 PR_GATE_BASE_REFS 才触发
GATE_PR_FILTER="[[{\"type\":\"EVENT\",\"pattern\":\"PULL_REQUEST_CREATED,PULL_REQUEST_UPDATED,PULL_REQUEST_REOPENED\"},{\"type\":\"BASE_REF\",\"pattern\":\"$PR_GATE_BASE_REFS\"}]]"
if aws codebuild batch-get-projects --names stayright-gate-pr --query 'projects[0].webhook.url' --output text 2>/dev/null | grep -q https; then
  echo "stayright-gate-pr webhook 已存在，更新 filter"
  aws codebuild update-webhook --project-name stayright-gate-pr \
    --filter-groups "$GATE_PR_FILTER" --region "$REGION" >/dev/null
else
  aws codebuild create-webhook --project-name stayright-gate-pr \
    --filter-groups "$GATE_PR_FILTER" --region "$REGION" >/dev/null
  echo "已创建 stayright-gate-pr webhook"
fi

# ---------------------------------------------------------------------------
say "5. CodePipeline：Source → Gate → 人工审批 → Deploy(backend+frontend 并行)"
# ---------------------------------------------------------------------------
cat > /tmp/pipeline-def.json <<EOF
{
  "pipeline": {
    "name": "stayright-dev-pipeline",
    "roleArn": "$PIPELINE_ROLE_ARN",
    "artifactStore": {
      "type": "S3",
      "location": "$RAW_BUCKET"
    },
    "stages": [
      {
        "name": "Source",
        "actions": [{
          "name": "GitHub_Source",
          "actionTypeId": {"category": "Source", "owner": "AWS", "provider": "CodeStarSourceConnection", "version": "1"},
          "outputArtifacts": [{"name": "SourceOutput"}],
          "configuration": {
            "ConnectionArn": "$CONNECTION_ARN",
            "FullRepositoryId": "$GITHUB_OWNER/$GITHUB_REPO",
            "BranchName": "$GITHUB_BRANCH",
            "DetectChanges": "true"
          }
        }]
      },
      {
        "name": "Gate",
        "actions": [{
          "name": "RunTests",
          "actionTypeId": {"category": "Build", "owner": "AWS", "provider": "CodeBuild", "version": "1"},
          "inputArtifacts": [{"name": "SourceOutput"}],
          "outputArtifacts": [{"name": "GateOutput"}],
          "configuration": {"ProjectName": "stayright-gate"}
        }]
      },
      {
        "name": "Approval",
        "actions": [{
          "name": "ManualApproval",
          "actionTypeId": {"category": "Approval", "owner": "AWS", "provider": "Manual", "version": "1"},
          "configuration": {
            "CustomData": "Gate 已通过，确认要把这个 commit 部署到 dev EC2 + CloudFront 吗？"
          }
        }]
      },
      {
        "name": "Deploy",
        "actions": [
          {
            "name": "DeployBackend",
            "actionTypeId": {"category": "Build", "owner": "AWS", "provider": "CodeBuild", "version": "1"},
            "inputArtifacts": [{"name": "SourceOutput"}],
            "configuration": {"ProjectName": "stayright-deploy-backend"},
            "runOrder": 1
          },
          {
            "name": "DeployFrontend",
            "actionTypeId": {"category": "Build", "owner": "AWS", "provider": "CodeBuild", "version": "1"},
            "inputArtifacts": [{"name": "SourceOutput"}],
            "configuration": {"ProjectName": "stayright-deploy-frontend"},
            "runOrder": 1
          }
        ]
      }
    ]
  }
}
EOF

if aws codepipeline get-pipeline --name stayright-dev-pipeline >/dev/null 2>&1; then
  echo "pipeline 已存在，更新定义"
  aws codepipeline update-pipeline --cli-input-json file:///tmp/pipeline-def.json >/dev/null
else
  aws codepipeline create-pipeline --cli-input-json file:///tmp/pipeline-def.json >/dev/null
  echo "已创建 pipeline: stayright-dev-pipeline"
fi

# ---------------------------------------------------------------------------
say "完成"
# ---------------------------------------------------------------------------
echo "Connection 状态: $CONN_STATUS"
if [ "$CONN_STATUS" != "AVAILABLE" ]; then
  echo ""
  echo "⚠️  下一步必须手动做：去控制台完成 GitHub 授权握手，否则 pipeline 的 Source 阶段会一直失败："
  echo "    https://$REGION.console.aws.amazon.com/codesuite/settings/connections?region=$REGION"
  echo "    找到 connection「${CONNECTION_NAME}」→ Update pending connection → 授权 GitHub → 选择组织 ${GITHUB_OWNER}"
fi
echo ""
echo "触发方式："
echo "  - PR 进 Test / main：CodeBuild stayright-gate-pr 经 GitHub webhook 自动跑 gate，"
echo "    结果回写 PR commit status。"
echo "  - 提交进 main（PR 合并后）：CodePipeline 自动跑 Gate → 人工审批 → 部署"
echo "    （DetectChanges=true，盯 main）。也可手动："
echo "        aws codepipeline start-pipeline-execution --name stayright-dev-pipeline --region $REGION"
echo ""
echo "webhook 依赖 CodeConnections 连接有 GitHub App 的 webhook 权限；若 stayright-gate-pr"
echo "的 webhook 创建报权限错，去连接的 GitHub App 安装里确认对 $GITHUB_REPO 已授权。"
