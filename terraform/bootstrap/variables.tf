variable "aws_account_id" {
  description = "AWS account that hosts TripWise. The provider refuses to run against any other account."
  type        = string
  default     = "651532007957"
}

variable "github_repo" {
  description = "GitHub repository (owner/name) whose production environment may assume the deploy role."
  type        = string
  default     = "gautampanigrahi/tripwise"
  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repo))
    error_message = "github_repo must look like owner/name."
  }
}

variable "state_bucket_name" {
  description = "Terraform state bucket name. Null derives tripwise-tfstate-<account id>."
  type        = string
  default     = null
}

variable "state_key" {
  description = "Object key of the main config's state in the state bucket (must match terraform/backend.tf)."
  type        = string
  default     = "tripwise/terraform.tfstate"
}

variable "create_oidc_provider" {
  description = "Create the token.actions.githubusercontent.com OIDC provider. Set false to reuse one that already exists in the account (only one per URL is allowed)."
  type        = bool
  # No provider for token.actions.githubusercontent.com existed in 651532007957 when this was written.
  default = true
}
