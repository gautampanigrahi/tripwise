#!/usr/bin/env bash
# Builds and deploys TripWise with Terraform.
#
# Usage: scripts/deploy.sh [extra terraform apply args, e.g. -auto-approve -var region=us-west-2]
#
# Steps: bundle the Lambdas, terraform apply, write web/.env.local from the outputs,
# build the web app, upload web/dist and catalog/, then invalidate the CloudFront cache.
set -euo pipefail

cd "$(dirname "$0")/.."

for cmd in terraform aws npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: '$cmd' is not installed or not on PATH" >&2; exit 1; }
done

echo "==> Building Lambda bundles"
npm run build:lambdas

echo "==> Applying Terraform"
# State lives in the S3 backend from terraform/backend.tf. If init fails because the
# local state has not been moved yet, run scripts/migrate-state.sh once first.
if ! terraform -chdir=terraform init -input=false; then
  cat >&2 <<EOF
error: terraform init failed.
If the message above says a backend change or state migration is required,
run scripts/migrate-state.sh once (after applying terraform/bootstrap/), then re-run this script.
Otherwise check your AWS credentials and that the state bucket exists.
EOF
  exit 1
fi
terraform -chdir=terraform apply "$@"

out() { terraform -chdir=terraform output -raw "$1"; }

APP_URL="$(out AppUrl)"
WEB_BUCKET="$(out WebBucketName)"
DATA_BUCKET="$(out DataBucketName)"
DISTRIBUTION_ID="$(out DistributionId)"
USER_POOL_ID="$(out UserPoolId)"
TABLE_NAME="$(out TableName)"
REMINDER_FUNCTION_ARN="$(out ReminderFunctionArn)"
SCHEDULER_ROLE_ARN="$(out SchedulerRoleArn)"
# The web app expects the Hosted UI domain without a scheme.
COGNITO_DOMAIN="$(out CognitoDomain)"
COGNITO_DOMAIN="${COGNITO_DOMAIN#https://}"

echo "==> Writing web/.env.local"
cat > web/.env.local <<EOF
VITE_USER_POOL_ID=${USER_POOL_ID}
VITE_USER_POOL_CLIENT_ID=$(out UserPoolClientId)
VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN}
VITE_API_URL=$(out ApiUrl)
EOF

echo "==> Building web app"
npm run build -w web

echo "==> Uploading web app to s3://${WEB_BUCKET}"
aws s3 sync web/dist "s3://${WEB_BUCKET}" --delete

echo "==> Uploading catalog to s3://${DATA_BUCKET}/catalog/"
aws s3 sync catalog "s3://${DATA_BUCKET}/catalog/"

echo "==> Invalidating CloudFront distribution ${DISTRIBUTION_ID}"
aws cloudfront create-invalidation --distribution-id "${DISTRIBUTION_ID}" --paths "/*" >/dev/null

cat <<EOF

Deployed: ${APP_URL}

Seed the demo trip with:
  USER_POOL_ID=${USER_POOL_ID} \\
  TABLE_NAME=${TABLE_NAME} \\
  REMINDER_FUNCTION_ARN=${REMINDER_FUNCTION_ARN} \\
  SCHEDULER_ROLE_ARN=${SCHEDULER_ROLE_ARN} \\
  npm run seed -w scripts
EOF
