# TripWise_API: HTTP API with a Cognito JWT authorizer on every route (Req 1.3), and the
# eight Lambda functions. The zips come from `npm run build:lambdas` (dist/lambda/<name>.zip),
# which must run before `terraform plan`/`apply` (filebase64sha256 reads them at plan time).

locals {
  reminder_schedule_prefix = "trip-reminder-"

  # Static key list (not keys(local.functions)) so names/ARNs can be used inside local.functions.
  function_keys  = ["trips", "invites", "items", "catalog", "checks", "explain", "reminder", "drafts"]
  function_names = { for k in local.function_keys : k => "${var.project}-${k}-${local.suffix}" }

  base_env = {
    NODE_OPTIONS = "--enable-source-maps"
    TABLE_NAME   = aws_dynamodb_table.main.name
    GSI1_NAME    = "GSI1"
  }

  # Per-function settings: timeout in seconds and environment variables.
  functions = {
    trips = {
      timeout = 10
      env = merge(local.base_env, {
        REMINDER_FUNCTION_ARN    = local.function_arns["reminder"]
        SCHEDULER_ROLE_ARN       = aws_iam_role.scheduler.arn
        REMINDER_SCHEDULE_PREFIX = local.reminder_schedule_prefix
      })
    }
    invites = {
      timeout = 10
      env     = merge(local.base_env, { TOPIC_ARN = aws_sns_topic.notifications.arn, APP_URL = local.app_url })
    }
    # items-fn looks up map pins and fills a listing. Grounding needs most of the 30 s API limit.
    items = {
      timeout = 29
      env     = merge(local.base_env, { DATA_BUCKET = aws_s3_bucket.data.bucket, MODEL_ID = var.model_id })
    }
    catalog = {
      timeout = 10
      env = {
        NODE_OPTIONS    = "--enable-source-maps"
        DATA_BUCKET     = aws_s3_bucket.data.bucket
        CATALOG_VERSION = var.catalog_version
      }
    }
    # checks-fn waits for explain-fn (10 s) and must still store a template on failure.
    checks = {
      timeout = 20
      env = merge(local.base_env, {
        DATA_BUCKET           = aws_s3_bucket.data.bucket
        CATALOG_VERSION       = var.catalog_version
        ENABLED_CHECKS        = var.enabled_checks
        EXPLAIN_FUNCTION_NAME = local.function_names["explain"]
        TOPIC_ARN             = aws_sns_topic.notifications.arn
      })
    }
    # Req 21.5: explain-fn has a 10 s timeout.
    explain = {
      timeout = 10
      env     = merge(local.base_env, { MODEL_ID = var.model_id })
    }
    reminder = {
      timeout = 10
      env     = merge(local.base_env, { TOPIC_ARN = aws_sns_topic.notifications.arn })
    }
    # Req 22.24: drafts-fn calls Bedrock with an 8 s abort inside a 10 s Lambda timeout.
    drafts = {
      timeout = 10
      env     = merge(local.base_env, { MODEL_ID = var.model_id })
    }
  }

  # Every HTTP route (matches services/api/src/routes.ts): route key => function.
  routes = {
    "POST /trips"                                                  = "trips"
    "GET /trips"                                                   = "trips"
    "GET /trips/{tripId}"                                          = "trips"
    "PUT /trips/{tripId}/constraints"                              = "trips"
    "GET /trips/{tripId}/constraints"                              = "trips"
    "POST /trips/{tripId}/invitations"                             = "invites"
    "POST /invitations/{inviteId}/accept"                          = "invites"
    "GET /trips/{tripId}/sections/{section}/items"                 = "items"
    "POST /trips/{tripId}/sections/{section}/items"                = "items"
    "PUT /trips/{tripId}/sections/{section}/items/{itemId}"        = "items"
    "DELETE /trips/{tripId}/sections/{section}/items/{itemId}"     = "items"
    "POST /trips/{tripId}/sections/Checklist/items/{itemId}/claim" = "items"
    "POST /trips/{tripId}/items/{itemId}/confirmation-upload"      = "items"
    "GET /trips/{tripId}/items/{itemId}/confirmation"              = "items"
    "POST /trips/{tripId}/lodging/from-link"                       = "items"
    "GET /catalog"                                                 = "catalog"
    "POST /trips/{tripId}/checks"                                  = "checks"
    "POST /trips/{tripId}/checks/alternatives"                     = "checks"
    "GET /trips/{tripId}/checks"                                   = "checks"
    "POST /trips/{tripId}/drafts"                                  = "drafts"
  }

  api_functions = toset(distinct(values(local.routes)))
}

# --- Lambda functions (Req 25.2, 26.1) ---
resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.function_names[each.key]}"
  retention_in_days = 30
}

resource "aws_lambda_function" "fn" {
  for_each         = local.functions
  function_name    = local.function_names[each.key]
  role             = aws_iam_role.fn[each.key].arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"]
  memory_size      = 512
  timeout          = each.value.timeout
  filename         = "${path.module}/../dist/lambda/${each.key}.zip"
  source_code_hash = filebase64sha256("${path.module}/../dist/lambda/${each.key}.zip")

  environment {
    variables = each.value.env
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.fn[each.key].name
  }

  depends_on = [aws_iam_role_policy.fn]
}

# --- HTTP API ---
resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = local.cors_origins
    allow_methods = ["GET", "POST", "PUT", "DELETE"]
    allow_headers = ["Authorization", "Content-Type"]
    max_age       = 3600
  }
}

# Req 1.3: API Gateway rejects missing/invalid tokens with 401 before any Lambda runs.
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  name             = "CognitoAuthorizer"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://${aws_cognito_user_pool.main.endpoint}"
    audience = [aws_cognito_user_pool_client.web.id]
  }
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each               = local.api_functions
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "main" {
  for_each           = local.routes
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.fn[each.value].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

# --- Invoke permissions ---
resource "aws_lambda_permission" "api" {
  for_each      = local.api_functions
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "scheduler" {
  statement_id   = "AllowSchedulerInvoke"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.fn["reminder"].function_name
  principal      = "scheduler.amazonaws.com"
  source_account = local.account
  source_arn     = local.reminder_schedules
}
