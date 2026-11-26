#!/usr/bin/env bash
# One-time move of the main Terraform state from terraform/terraform.tfstate (local)
# to the S3 backend declared in terraform/backend.tf.
#
# Prerequisites:
#   - terraform/bootstrap/ has been applied (it creates the state bucket).
#   - AWS credentials for account 651532007957 are active in this shell.
#
# Steps: check the bucket exists, back up the local state (inside and outside the repo),
# run `terraform init -migrate-state`, then confirm `terraform plan` reports no changes.
# Exits 0 only when the plan is empty.
set -euo pipefail
cd "$(dirname "$0")/.."

STATE_BUCKET="tripwise-tfstate-651532007957"
STATE_KEY="tripwise/terraform.tfstate"
LOCAL_STATE="terraform/terraform.tfstate"
OUTSIDE_BACKUP_DIR="${HOME}/tripwise-tfstate-backups"

rollback_help() {
  cat >&2 <<EOF

How to roll back to local state:
  1. Restore the backup:
       cp "${REPO_BACKUP:-terraform/terraform.tfstate.backup-<timestamp>}" ${LOCAL_STATE}
     (a second copy is in ${OUTSIDE_BACKUP_DIR}/)
  2. Remove (or rename) terraform/backend.tf so the config uses the local backend again.
  3. Run: terraform -chdir=terraform init -reconfigure
     (uses the restored local file as-is; alternatively run
      terraform -chdir=terraform init -migrate-state to copy the S3 state back down).
  4. Run: terraform -chdir=terraform plan
     and confirm it reports no changes.
The state object in s3://${STATE_BUCKET}/${STATE_KEY} can be left in place
(the bucket is versioned) or deleted once you are back on local state.
EOF
}

for cmd in terraform aws npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "error: '$cmd' is not installed or not on PATH" >&2; exit 1; }
done

if [[ ! -f terraform/backend.tf ]]; then
  echo "error: terraform/backend.tf not found; nothing to migrate to" >&2
  exit 1
fi

if [[ ! -s "${LOCAL_STATE}" ]]; then
  echo "error: ${LOCAL_STATE} not found or empty; refusing to migrate" >&2
  echo "(if the state was already migrated, run: terraform -chdir=terraform init)" >&2
  exit 1
fi

echo "==> Checking state bucket s3://${STATE_BUCKET}"
if ! aws s3api head-bucket --bucket "${STATE_BUCKET}" >/dev/null 2>&1; then
  echo "error: state bucket ${STATE_BUCKET} does not exist or is not accessible with the current credentials" >&2
  echo "Apply terraform/bootstrap/ first (and check your AWS credentials)." >&2
  exit 1
fi

if aws s3api head-object --bucket "${STATE_BUCKET}" --key "${STATE_KEY}" >/dev/null 2>&1; then
  echo "error: s3://${STATE_BUCKET}/${STATE_KEY} already exists; refusing to overwrite it" >&2
  echo "Inspect it first. If it is stale, delete it and run this script again." >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
REPO_BACKUP="terraform/terraform.tfstate.backup-${TIMESTAMP}"
OUTSIDE_BACKUP="${OUTSIDE_BACKUP_DIR}/terraform.tfstate.backup-${TIMESTAMP}"

echo "==> Backing up ${LOCAL_STATE}"
cp -p "${LOCAL_STATE}" "${REPO_BACKUP}"
mkdir -p "${OUTSIDE_BACKUP_DIR}"
chmod 700 "${OUTSIDE_BACKUP_DIR}"
cp -p "${LOCAL_STATE}" "${OUTSIDE_BACKUP}"
echo "    ${REPO_BACKUP}"
echo "    ${OUTSIDE_BACKUP}"

trap 'echo "error: migration did not finish cleanly." >&2; rollback_help' ERR

echo "==> Migrating state to s3://${STATE_BUCKET}/${STATE_KEY}"
terraform -chdir=terraform init -migrate-state -force-copy -input=false

echo "==> Building Lambda bundles (plan reads the zips)"
npm run build:lambdas

echo "==> Checking that the migrated state matches the live stack"
trap - ERR
set +e
terraform -chdir=terraform plan -detailed-exitcode -input=false
PLAN_EXIT=$?
set -e

case "${PLAN_EXIT}" in
  0)
    cat <<EOF

State migrated to s3://${STATE_BUCKET}/${STATE_KEY} and the plan reports no changes.
Backups: ${REPO_BACKUP} and ${OUTSIDE_BACKUP}
Terraform keeps reading the S3 state from now on; ${LOCAL_STATE} is no longer used.
EOF
    exit 0
    ;;
  2)
    echo "error: plan reports changes after migration. Do NOT apply until you understand them." >&2
    rollback_help
    exit 2
    ;;
  *)
    echo "error: terraform plan failed (exit ${PLAN_EXIT})." >&2
    rollback_help
    exit 1
    ;;
esac
