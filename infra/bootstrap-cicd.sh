#!/usr/bin/env bash
# 一次性搭建 CI/CD 骨架：CodeStar Connection（GitHub）+ IAM 角色 +
# CodeBuild 项目（gate / deploy-backend / deploy-frontend）+ CodePipeline。
#
# 背景：这个仓库所在的 GitHub 组织在组织层面关掉了 Actions
# （repo 级 `actions/permissions` API 返回 409 "disabled by the
# organization"），.github/workflows/gate.yml 从写完那天起就没在 GitHub 上
# 真正跑过。这条路走不通之前，用 AWS 原生的 CodePipeline + CodeBuild 代替——
# 完全在你自己账号权限范围内，不需要组织 admin 批准任何东西。
#
# 这个脚本做的事全部可逆（IAM 角色 / CodeBuild 项目 / CodePipeline 都能用
# `aws iam delete-role` / `aws codebuild delete-project` /
# `aws codepipeline delete-pipeline` 撤掉），不改动任何现有资源
# （EC2/S3/CloudFront/SAM 栈原样不动）。
#
# 跑完这个脚本后，唯一需要你去 AWS 控制台手动点一下的步骤：
#   CodeStar Connection 建出来时状态是 PENDING，必须在控制台完成一次
#   GitHub OAuth 授权握手才会变 AVAILABLE——这一步 AWS 出于安全设计不允许
#   纯 CLI 完成，脚本跑完会打印控制台链接。
#
# 触发方式：手动触发（2026-09-08，Zachary 拍板）。Source 阶段的
# `DetectChanges: false` 关掉了 push 自动触发，pipeline 只有你主动执行
# `aws codepipeline start-pipeline-execution` 或在控制台点 "Release change"
# 才会跑一次。
#
# 【部署待决策点】后续计划改成：Test 分支 PR 到 main 分支合并后自动触发
# （而不是现在这种任何 push 到 Test 都可能触发）。这个决策还没定，涉及
# main/Test 两个分支的定位要不要调整（现在 main 落后 Test 几十个 commit，
# 基本不用）。定了之后把 DetectChanges 改回 true（或用 CodePipeline V2 的
# 显式 triggers 配置指到 main 分支），并同步改这里的注释和
# docs/AWS_SDK_SPEC.md 的部署方式章节。
#
# 用法：./infra/bootstrap-cicd.sh

set -euo pipefail

REGION="ap-southeast-2"
ACCOUNT_ID="990393187001"
RAW_BUCKET="stayright-dev-raw-990393187001"
SITE_BUCKET="stayright-dev-site-990393187001"
CF_DIST_ID="E3CNDKHDSY3D1I"
EC2_INSTANCE_ID="i-0d71260ab44ceb0c3"
GITHUB_OWNER="CS778-S2-2026-AWS-Challenge"
GITHUB_REPO="Kakapo"
GITHUB_BRANCH="Test"
CONNECTION_NAME="stayright-github"
PIPELINE_ARTIFACT_PREFIX="codepipeline-artifacts"

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
            "DetectChanges": "false"
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
echo "触发方式：手动。Source 阶段关掉了 push 自动触发（DetectChanges=false），"
echo "每次都要你自己发起，push 到 Test 分支不会自动跑："
echo "    aws codepipeline start-pipeline-execution --name stayright-dev-pipeline --region $REGION"
echo "  或在控制台 CodePipeline → stayright-dev-pipeline → Release change"
