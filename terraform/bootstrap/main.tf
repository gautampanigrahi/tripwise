data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  account   = data.aws_caller_identity.current.account_id
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.name

  state_bucket_name = coalesce(var.state_bucket_name, "tripwise-tfstate-${local.account}")
  oidc_host         = "token.actions.githubusercontent.com"
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
  # GitHub sends one of two subject forms depending on the repo's OIDC sub-claim
  # setting (gh api repos/<owner>/<repo>/actions/oidc/customization/sub):
  #   immutable: repo:<owner>@<owner_id>/<name>@<repo_id>:environment:production
  #   legacy:    repo:<owner>/<name>:environment:production
  github_owner = split("/", var.github_repo)[0]
  github_name  = split("/", var.github_repo)[1]
  deploy_subjects = [
    "repo:${local.github_owner}@${var.github_owner_id}/${local.github_name}@${var.github_repo_id}:environment:production",
    "repo:${var.github_repo}:environment:production",
  ]

  # Name patterns from the main config (terraform/*.tf). The suffix is random_id.suffix.
  # Bucket patterns are deliberately narrower than tripwise-* so they never match the
  # state bucket (tripwise-tfstate-*).
  data_bucket_arn = "arn:${local.partition}:s3:::tripwise-data-*"
  web_bucket_arn  = "arn:${local.partition}:s3:::tripwise-web-*"
  table_arn       = "arn:${local.partition}:dynamodb:${local.region}:${local.account}:table/tripwise-table"
  function_arn    = "arn:${local.partition}:lambda:${local.region}:${local.account}:function:tripwise-*"
  log_group_arn   = "arn:${local.partition}:logs:${local.region}:${local.account}:log-group:/aws/lambda/tripwise-*"
  topic_arn       = "arn:${local.partition}:sns:${local.region}:${local.account}:tripwise-*"
  # Lambda execution roles (tripwise-<fn>-<suffix>-role) and the scheduler role
  # (tripwise-scheduler-<suffix>). The deploy role below is named so it does NOT match.
  app_role_arn     = "arn:${local.partition}:iam::${local.account}:role/tripwise-*"
  user_pool_arn    = "arn:${local.partition}:cognito-idp:${local.region}:${local.account}:userpool/*"
  distribution_arn = "arn:${local.partition}:cloudfront::${local.account}:distribution/*"
  oac_arn          = "arn:${local.partition}:cloudfront::${local.account}:origin-access-control/*"
}

# --- Terraform state bucket (Req 25.4, 25.5) ---
resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket_name
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket     = aws_s3_bucket.state.id
  policy     = data.aws_iam_policy_document.state_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.state]
}

# --- GitHub OIDC provider (one per URL per account) ---
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
  # IAM validates GitHub's certificate through its own trusted CA list; these are
  # GitHub's published thumbprints, kept for providers/clients that still require them.
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://${local.oidc_host}"
}

# --- Deploy role: only the production environment of github_repo can assume it ---
data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = local.deploy_subjects
    }
  }
}

resource "aws_iam_role" "deploy" {
  # Not tripwise-*, so the deploy policy's IAM statements cannot modify this role.
  name                 = "github-actions-tripwise-deploy"
  description          = "Assumed by GitHub Actions (${var.github_repo}, environment production) to deploy TripWise"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

# --- Deploy policy, part 1: Terraform remote state (S3 backend with use_lockfile) ---
data "aws_iam_policy_document" "deploy_state" {
  statement {
    sid       = "StateBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn]
  }
  statement {
    sid       = "StateObject"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.state.arn}/${var.state_key}"]
  }
  statement {
    sid       = "StateLockFile"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.state.arn}/${var.state_key}.tflock"]
  }
}

resource "aws_iam_role_policy" "deploy_state" {
  name   = "terraform-state"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_state.json
}

# --- Deploy policy, part 2: resources managed by terraform/*.tf, plus the upload steps ---
data "aws_iam_policy_document" "deploy_infra" {
  # data.tf: aws_dynamodb_table.main
  statement {
    sid = "DynamoDBTable"
    actions = [
      "dynamodb:CreateTable",
      "dynamodb:UpdateTable",
      "dynamodb:DeleteTable",
      "dynamodb:Describe*",
      "dynamodb:UpdateContinuousBackups",
      "dynamodb:UpdateTimeToLive",
      "dynamodb:ListTagsOfResource",
      "dynamodb:TagResource",
      "dynamodb:UntagResource",
    ]
    resources = [local.table_arn, "${local.table_arn}/index/*"]
  }

  # data.tf / web.tf: aws_s3_bucket.{data,web} and their public access block,
  # ownership controls, encryption, versioning, and bucket policy.
  statement {
    sid = "AppBuckets"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:ListBucket",
      "s3:GetBucket*",
      "s3:GetAccelerateConfiguration",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetReplicationConfiguration",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketOwnershipControls",
      "s3:PutEncryptionConfiguration",
      "s3:PutBucketVersioning",
      "s3:PutBucketPolicy",
      "s3:DeleteBucketPolicy",
      "s3:PutBucketTagging",
    ]
    resources = [local.data_bucket_arn, local.web_bucket_arn]
  }
  # deploy.sh: aws s3 sync web/dist --delete. Also covers force_destroy on WebBucket.
  statement {
    sid       = "WebBucketObjects"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucketVersions", "s3:DeleteObjectVersion"]
    resources = [local.web_bucket_arn, "${local.web_bucket_arn}/*"]
  }
  # deploy.sh: aws s3 sync catalog to catalog/ (no --delete). Confirmations under
  # private/trips/ stay out of reach.
  statement {
    sid       = "CatalogObjects"
    actions   = ["s3:PutObject"]
    resources = ["${local.data_bucket_arn}/catalog/*"]
  }

  # data.tf: aws_sns_topic.notifications and aws_sns_topic_policy.notifications
  statement {
    sid = "SnsTopic"
    actions = [
      "sns:CreateTopic",
      "sns:DeleteTopic",
      "sns:GetTopicAttributes",
      "sns:SetTopicAttributes",
      "sns:ListTagsForResource",
      "sns:TagResource",
      "sns:UntagResource",
    ]
    resources = [local.topic_arn]
  }

  # api.tf: aws_cloudwatch_log_group.fn
  statement {
    sid = "LogGroups"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
      "logs:DeleteRetentionPolicy",
      "logs:ListTagsForResource",
      "logs:ListTagsLogGroup",
      "logs:TagResource",
      "logs:TagLogGroup",
      "logs:UntagResource",
      "logs:UntagLogGroup",
    ]
    resources = [local.log_group_arn, "${local.log_group_arn}:*"]
  }
  # Refresh reads log groups with DescribeLogGroups, which is authorized against
  # the account's log-group:* resource rather than a single group.
  statement {
    sid       = "DescribeLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["arn:${local.partition}:logs:${local.region}:${local.account}:log-group:*"]
  }

  # api.tf: aws_lambda_function.fn, aws_lambda_permission.{api,scheduler}
  statement {
    sid = "LambdaFunctions"
    actions = [
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:Get*",
      "lambda:List*",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:PublishVersion",
      "lambda:PutFunctionConcurrency",
      "lambda:DeleteFunctionConcurrency",
      "lambda:PutRuntimeManagementConfig",
      "lambda:AddPermission",
      "lambda:RemovePermission",
      "lambda:TagResource",
      "lambda:UntagResource",
    ]
    resources = [local.function_arn]
  }

  # iam.tf: aws_iam_role.{fn,scheduler} and aws_iam_role_policy.{fn,scheduler}.
  # Limited to tripwise-* roles; the deploy role is excluded by its name.
  statement {
    sid = "AppRoles"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
      "iam:UpdateAssumeRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:GetRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
    ]
    resources = [local.app_role_arn]
  }
  # Terraform passes the execution roles to Lambda only; the scheduler role is
  # passed at runtime by trips-fn, not by the deploy role.
  statement {
    sid       = "PassAppRolesToLambda"
    actions   = ["iam:PassRole"]
    resources = [local.app_role_arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  # api.tf: aws_apigatewayv2_{api,authorizer,integration,route,stage}. API Gateway
  # authorizes by resource path, and API ids are random, so the scope is every HTTP
  # API path in this Region plus the tagging path.
  statement {
    sid     = "HttpApi"
    actions = ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE"]
    resources = [
      "arn:${local.partition}:apigateway:${local.region}::/apis",
      "arn:${local.partition}:apigateway:${local.region}::/apis/*",
      "arn:${local.partition}:apigateway:${local.region}::/tags/*",
    ]
  }

  # auth.tf: aws_cognito_user_pool.main, aws_cognito_user_pool_client.web,
  # aws_cognito_user_pool_domain.main. Pool ids are random, so the scope is the
  # account's user pools in this Region.
  statement {
    sid = "CognitoUserPool"
    actions = [
      "cognito-idp:DescribeUserPool",
      "cognito-idp:UpdateUserPool",
      "cognito-idp:DeleteUserPool",
      "cognito-idp:GetUserPoolMfaConfig",
      "cognito-idp:SetUserPoolMfaConfig",
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:UpdateUserPoolClient",
      "cognito-idp:DeleteUserPoolClient",
      "cognito-idp:CreateUserPoolDomain",
      "cognito-idp:UpdateUserPoolDomain",
      "cognito-idp:DeleteUserPoolDomain",
      "cognito-idp:ListTagsForResource",
      "cognito-idp:TagResource",
      "cognito-idp:UntagResource",
    ]
    resources = [local.user_pool_arn]
  }
  # CreateUserPool and DescribeUserPoolDomain do not support resource-level permissions.
  statement {
    sid       = "CognitoNoResourceLevel"
    actions   = ["cognito-idp:CreateUserPool", "cognito-idp:DescribeUserPoolDomain"]
    resources = ["*"]
  }

  # web.tf: aws_cloudfront_distribution.web, plus deploy.sh's create-invalidation.
  # Distribution ids are random, so the scope is the account's distributions.
  statement {
    sid = "CloudFrontDistribution"
    actions = [
      "cloudfront:CreateDistribution",
      "cloudfront:CreateDistributionWithTags",
      "cloudfront:GetDistribution",
      "cloudfront:GetDistributionConfig",
      "cloudfront:UpdateDistribution",
      "cloudfront:DeleteDistribution",
      "cloudfront:ListTagsForResource",
      "cloudfront:TagResource",
      "cloudfront:UntagResource",
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]
    resources = [local.distribution_arn]
  }
  # web.tf: aws_cloudfront_origin_access_control.web
  statement {
    sid = "CloudFrontOac"
    actions = [
      "cloudfront:CreateOriginAccessControl",
      "cloudfront:GetOriginAccessControl",
      "cloudfront:GetOriginAccessControlConfig",
      "cloudfront:UpdateOriginAccessControl",
      "cloudfront:DeleteOriginAccessControl",
    ]
    resources = [local.oac_arn]
  }
}

resource "aws_iam_role_policy" "deploy_infra" {
  name   = "tripwise-deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy_infra.json
}
