# TripWise root module. Everything lives in one Region (Req 25.1).
# Uses local state; no backend is configured.

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project = var.project
    }
  }
}

# Suffix that keeps S3 bucket names and the Cognito Hosted UI domain globally unique.
resource "random_id" "suffix" {
  byte_length = 4
}

locals {
  suffix = random_id.suffix.hex

  # CloudFront origin (no trailing slash) for CORS, and the app URL used as the OAuth callback.
  app_origin = "https://${aws_cloudfront_distribution.web.domain_name}"
  app_url    = "${local.app_origin}/"

  callback_urls = concat([local.app_url], var.extra_callback_urls)
  cors_origins  = concat([local.app_origin], var.extra_cors_origins)
}
