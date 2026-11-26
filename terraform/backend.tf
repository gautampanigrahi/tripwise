# Remote state in the bucket created by terraform/bootstrap/.
# Backend blocks cannot use variables, so the values are literals.
# S3 native locking (use_lockfile) needs Terraform >= 1.10; no DynamoDB lock table.
#
# Existing local state is moved here once with scripts/migrate-state.sh.
terraform {
  backend "s3" {
    bucket       = "tripwise-tfstate-651532007957"
    key          = "tripwise/terraform.tfstate"
    region       = "us-west-2"
    encrypt      = true
    use_lockfile = true
  }
}
