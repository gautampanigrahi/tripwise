variable "region" {
  description = "AWS Region for every TripWise resource (Req 25.1)."
  type        = string
  default     = "us-west-2"
}

variable "project" {
  description = "Name prefix for resources (table, topic, buckets, Cognito domain)."
  type        = string
  default     = "tripwise"

  validation {
    condition     = can(regex("^[a-z0-9-]{3,20}$", var.project))
    error_message = "project must be 3-20 characters of lowercase letters, digits, or hyphens."
  }
}

variable "extra_callback_urls" {
  description = "Extra OAuth callback/logout URLs, e.g. [\"http://localhost:5173/\"] for local dev."
  type        = list(string)
  default     = []
}

variable "extra_cors_origins" {
  description = "Extra API CORS origins, e.g. [\"http://localhost:5173\"] for local dev."
  type        = list(string)
  default     = []
}

variable "catalog_version" {
  description = "Catalog version loaded from s3://<DataBucket>/catalog/<version>.json (CATALOG_VERSION)."
  type        = string
  default     = "san-diego-v1"
}

variable "enabled_checks" {
  description = "Comma-separated feasibility checks enabled on checks-fn (ENABLED_CHECKS)."
  type        = string
  default     = "Cost,Capacity,Dates,Schedule,Preferences"
}

variable "model_id" {
  description = "Bedrock model ID used by explain-fn (MODEL_ID)."
  type        = string
  default     = "anthropic.claude-3-haiku-20240307-v1:0"
}
