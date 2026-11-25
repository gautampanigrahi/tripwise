# Values for web/.env.local and scripts/deploy.sh.

output "AppUrl" {
  value = local.app_url
}

output "ApiUrl" {
  value = aws_apigatewayv2_api.main.api_endpoint
}

output "ReminderFunctionArn" {
  value = aws_lambda_function.fn["reminder"].arn
}

output "SchedulerRoleArn" {
  value = aws_iam_role.scheduler.arn
}

output "UserPoolId" {
  value = aws_cognito_user_pool.main.id
}

output "UserPoolClientId" {
  value = aws_cognito_user_pool_client.web.id
}

output "CognitoDomain" {
  value = "${aws_cognito_user_pool_domain.main.domain}.auth.${var.region}.amazoncognito.com"
}

output "DataBucketName" {
  value = aws_s3_bucket.data.bucket
}

output "TableName" {
  value = aws_dynamodb_table.main.name
}

output "WebBucketName" {
  value = aws_s3_bucket.web.bucket
}

output "DistributionId" {
  value = aws_cloudfront_distribution.web.id
}
