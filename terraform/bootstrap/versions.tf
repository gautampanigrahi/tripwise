# TripWise bootstrap: the remote-state bucket, the GitHub OIDC provider, and the
# GitHub Actions deploy role. Applied once from a laptop with admin credentials.
# This config keeps its own state locally (terraform/bootstrap/terraform.tfstate,
# ignored by the root .gitignore); there is deliberately no backend block.
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-west-2"
  # Refuse to run against any other account.
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = {
      Project = "tripwise"
    }
  }
}
