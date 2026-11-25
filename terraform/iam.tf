# Least-privilege IAM (Req 25.3): one execution role per function, each with an inline
# policy on exact ARNs (design §11 table), plus the EventBridge Scheduler role.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account   = data.aws_caller_identity.current.account_id
  partition = data.aws_partition.current.partition

  table_arns         = [aws_dynamodb_table.main.arn]
  table_and_gsi_arns = [aws_dynamodb_table.main.arn, "${aws_dynamodb_table.main.arn}/index/GSI1"]
  catalog_objects    = "${aws_s3_bucket.data.arn}/catalog/*"
  private_trips      = "${aws_s3_bucket.data.arn}/private/trips/*"
  topic_arn          = aws_sns_topic.notifications.arn
  reminder_schedules = "arn:${local.partition}:scheduler:${var.region}:${local.account}:schedule/default/${local.reminder_schedule_prefix}*"
  model_arn          = "arn:${local.partition}:bedrock:${var.region}::foundation-model/${var.model_id}"

  # Function ARNs computed from names so trips-fn/checks-fn can reference reminder-fn/explain-fn
  # without a self-reference inside the aws_lambda_function.fn for_each.
  function_arns = {
    for k, name in local.function_names :
    k => "arn:${local.partition}:lambda:${var.region}:${local.account}:function:${name}"
  }

  # Inline policy statements per function: [actions, resources].
  function_statements = {
    trips = [
      [["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:TransactWriteItems"], local.table_and_gsi_arns],
      [["scheduler:CreateSchedule", "scheduler:UpdateSchedule"], [local.reminder_schedules]],
      [["iam:PassRole"], [aws_iam_role.scheduler.arn]],
    ]
    invites = [
      [["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:TransactWriteItems", "dynamodb:Query"], local.table_and_gsi_arns],
      [["sns:Publish", "sns:Subscribe"], [local.topic_arn]],
    ]
    items = [
      [["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"], local.table_arns],
      [["s3:PutObject", "s3:GetObject"], [local.private_trips]],
      [["bedrock:InvokeModel"], [local.model_arn]],
    ]
    catalog = [
      [["s3:GetObject"], [local.catalog_objects]],
    ]
    checks = [
      # UpdateItem: stores the template explanation when explain-fn fails (Req 21.6).
      [["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"], local.table_arns],
      [["s3:GetObject"], [local.catalog_objects]],
      [["lambda:InvokeFunction"], [local.function_arns["explain"]]],
      [["sns:Publish"], [local.topic_arn]],
    ]
    explain = [
      [["dynamodb:GetItem", "dynamodb:UpdateItem"], local.table_arns],
      [["bedrock:InvokeModel"], [local.model_arn]],
    ]
    reminder = [
      [["dynamodb:GetItem", "dynamodb:Query"], local.table_arns],
      [["sns:Publish"], [local.topic_arn]],
    ]
    # Read-only on the base table (META, CONSTRAINTS, MEMBER and ScratchPad items by PK;
    # no GSI1 reads) plus the one model. No write actions (Req 22.17, 25.3).
    drafts = [
      [["dynamodb:GetItem", "dynamodb:Query"], local.table_arns],
      [["bedrock:InvokeModel"], [local.model_arn]],
    ]
  }
}

# --- Lambda execution roles ---
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "fn" {
  for_each           = local.functions
  name               = "${local.function_names[each.key]}-role"
  description        = "TripWise ${each.key}-fn execution role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "fn" {
  for_each = local.functions
  name     = "${each.key}-fn"
  role     = aws_iam_role.fn[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${aws_cloudwatch_log_group.fn[each.key].arn}:*"]
      }],
      [for s in local.function_statements[each.key] : {
        Effect   = "Allow"
        Action   = s[0]
        Resource = s[1]
      }]
    )
  })
}

# --- EventBridge Scheduler role: may only invoke reminder-fn (Req 24.2) ---
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.project}-scheduler-${local.suffix}"
  description        = "EventBridge Scheduler role for TripWise trip reminders"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  name = "invoke-reminder-fn"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [aws_lambda_function.fn["reminder"].arn]
    }]
  })
}
