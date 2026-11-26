# CI/CD setup

TripWise uses two GitHub Actions workflows in `gautampanigrahi/tripwise` and deploys to AWS account `651532007957` in `us-west-2`. GitHub assumes an IAM role through OIDC, so no AWS keys are stored in GitHub.

## The workflows

**CI** (`.github/workflows/ci.yml`) runs on every push and pull request, and is also called by the deploy workflow. It uses no AWS credentials. It runs:

- `npm ci`, `npm run typecheck`, `npx vitest --run`, `npm run build:lambdas`, `npm run build -w web`
- `terraform fmt -check -recursive`, then `terraform init -backend=false` and `terraform validate` in `terraform/` and in `terraform/bootstrap/`

**Deploy** (`.github/workflows/deploy.yml`) runs on a push to `main` and on manual dispatch (Actions → Deploy → Run workflow). It first runs CI as a job. If CI passes, the deploy job:

1. Waits for approval in the `production` environment.
2. Assumes the role in the `AWS_DEPLOY_ROLE_ARN` repository variable.
3. Builds the Lambda bundles and runs `terraform init`, `terraform plan -out=tfplan` (the plan is shown in the run summary), a destructive-change guard, and `terraform apply tfplan`.
4. Writes `web/.env.local` from the Terraform outputs, builds the web app, deletes `.env.local`, syncs `web/dist` to the web bucket with `--delete`, syncs `catalog/` to `catalog/` in the data bucket without `--delete`, and invalidates CloudFront.

Only one deploy runs at a time (concurrency group `deploy-production`). A second run queues and the first is not cancelled.

**Destructive-change guard.** Before apply, the job fails if the plan deletes or replaces the DynamoDB table (`aws_dynamodb_table.main`), the Cognito user pool (`aws_cognito_user_pool.main`), the data bucket (`aws_s3_bucket.data`), or the CloudFront distribution. If you intend that change, start the workflow manually and tick **allow_destructive**. The input only exists on manual runs, so a push to `main` can never bypass the guard.

## One-time setup

Do these steps in order, from the repository root on a laptop that has admin credentials for account `651532007957`, Terraform 1.10 or later, the AWS CLI, and `gh` (logged in).

### 1. Commit and push the CI/CD files

Commit `.github/workflows/`, `terraform/bootstrap/`, `terraform/backend.tf`, `scripts/migrate-state.sh`, and the updated `scripts/deploy.sh`, then push.

CI will fail until the current typecheck errors in `services/api/src/handlers/drafts.ts` are fixed (a separate task covers this). Get CI green before you rely on the deploy workflow. When CI fails, the deploy job does not run.

If you push to `main` before finishing the steps below, the deploy job fails at "Configure AWS credentials" because the variable is not set yet. Nothing changes in AWS. GitHub may also create an unprotected `production` environment automatically the first time a job references it. Step 5 adds the reviewer to that environment.

### 2. Apply the bootstrap config

```sh
terraform -chdir=terraform/bootstrap init
terraform -chdir=terraform/bootstrap apply
```

Review the plan and type `yes`. It creates:

- The state bucket `tripwise-tfstate-651532007957`, with versioning, encryption, public access blocked, and TLS-only access.
- The GitHub OIDC provider for `token.actions.githubusercontent.com`. If the account already has one, apply with `-var create_oidc_provider=false` instead.
- The role `github-actions-tripwise-deploy`, which only `repo:gautampanigrahi/tripwise:environment:production` can assume, with its deploy policies.

The provider refuses to run against any account except `651532007957`.

When apply finishes, it prints two outputs. You can read them again at any time:

```sh
terraform -chdir=terraform/bootstrap output state_bucket_name   # tripwise-tfstate-651532007957
terraform -chdir=terraform/bootstrap output -raw deploy_role_arn # arn:aws:iam::651532007957:role/github-actions-tripwise-deploy
```

The bootstrap config keeps its own state in `terraform/bootstrap/terraform.tfstate`. Git ignores this file, so keep it (or a copy) safe. You need it to change the deploy role later.

### 3. Move the main state to S3

```sh
scripts/migrate-state.sh
```

The script:

1. Checks that the state bucket exists and that `tripwise/terraform.tfstate` is not already in it.
2. Backs up `terraform/terraform.tfstate` to `terraform/terraform.tfstate.backup-<timestamp>` and to `~/tripwise-tfstate-backups/`.
3. Runs `terraform -chdir=terraform init -migrate-state`.
4. Runs `npm run build:lambdas` and `terraform plan -detailed-exitcode`.

Success looks like this, with exit code 0:

```
State migrated to s3://tripwise-tfstate-651532007957/tripwise/terraform.tfstate and the plan reports no changes.
```

If the plan shows changes (exit 2) or fails, do not apply. The script prints rollback steps:

1. Copy the backup back to `terraform/terraform.tfstate` (`cp terraform/terraform.tfstate.backup-<timestamp> terraform/terraform.tfstate`).
2. Remove or rename `terraform/backend.tf`.
3. Run `terraform -chdir=terraform init -reconfigure`.
4. Run `terraform -chdir=terraform plan` and confirm it shows no changes.

The state object in S3 can stay where it is (the bucket is versioned), or you can delete it.

### 4. Set the role ARN as a repository variable

```sh
gh variable set AWS_DEPLOY_ROLE_ARN --body "<arn>" -R gautampanigrahi/tripwise
```

Use the `deploy_role_arn` output from step 2. Or pass the output directly:

```sh
gh variable set AWS_DEPLOY_ROLE_ARN \
  --body "$(terraform -chdir=terraform/bootstrap output -raw deploy_role_arn)" \
  -R gautampanigrahi/tripwise
```

This is a variable, not a secret. The ARN is not sensitive.

### 5. Create the `production` environment with a required reviewer

The name must be exactly `production`, because the role's trust policy matches it.

In the GitHub UI: open the repository, go to **Settings → Environments → New environment**, enter `production`, and click **Configure environment**. Under **Deployment protection rules**, tick **Required reviewers**, add yourself (and any teammates), and click **Save protection rules**. You can also set **Deployment branches and tags** to **Selected branches** with `main` only.

With `gh api`:

```sh
USER_ID=$(gh api users/gautampanigrahi --jq .id)
gh api -X PUT repos/gautampanigrahi/tripwise/environments/production \
  --input - <<EOF
{"reviewers":[{"type":"User","id":${USER_ID}}]}
EOF
```

Required reviewers work on public repositories on any plan. On a private repository they need GitHub Pro, Team, or Enterprise. The repository is currently public. If you make it private on a free plan, you cannot rely on the reviewer rule, so check the environment settings before the next deploy.

### 6. Run the first deploy

Go to **Actions → Deploy → Run workflow**, keep `main` and leave **allow_destructive** unticked, then click **Run workflow**. A push to `main` also starts a deploy. After CI passes, the run waits for approval. Click **Review deployments**, tick `production`, and approve. The run summary shows the Terraform plan and the app URL.

Because the state was just migrated and the plan was empty, the first run should show no infrastructure changes. It only re-uploads the web app and the catalog.

## Day to day

After the migration, laptop deploys (`npm run deploy`, which runs `scripts/deploy.sh`) and the Actions workflow use the same state in `s3://tripwise-tfstate-651532007957/tripwise/terraform.tfstate` and the same lock file (`tripwise/terraform.tfstate.tflock`). Do not run both at the same time. The lock makes the second run fail with "Error acquiring the state lock" instead of corrupting state, but the half-finished run still has to be redone.

Teammates no longer need the laptop's `terraform/terraform.tfstate`. Anyone with AWS credentials for the account can run `terraform -chdir=terraform init` and get the shared state. The old local file is no longer read. Keep the backups until a few deploys have succeeded.

## Troubleshooting

**Plan or apply fails with `AccessDenied` / "not authorized to perform: \<action\>".** The deploy role is missing a permission, usually because a new resource type was added to `terraform/*.tf`. Add the action to the matching statement in `data "aws_iam_policy_document" "deploy_infra"` in `terraform/bootstrap/main.tf`, or add a new statement scoped to `tripwise-*` resources. Then re-apply from the laptop:

```sh
terraform -chdir=terraform/bootstrap apply
```

Re-run the failed workflow afterwards. The error message names the action and the resource ARN.

**The state lock was left behind.** A cancelled or crashed run can leave `tripwise/terraform.tfstate.tflock` in the bucket, and later runs fail with "Error acquiring the state lock". First make sure no deploy is actually running, on the laptop or in Actions. Then use the lock ID from the error message:

```sh
terraform -chdir=terraform force-unlock <LOCK_ID>
```

**"Not authorized to perform sts:AssumeRoleWithWebIdentity".** The OIDC token did not match the role's trust policy. Check that:

- The deploy job still has `environment: production` and the environment name in GitHub is exactly `production`.
- `AWS_DEPLOY_ROLE_ARN` is set as a repository variable (`gh variable list -R gautampanigrahi/tripwise`) and matches `terraform -chdir=terraform/bootstrap output -raw deploy_role_arn`.
- The repository is still `gautampanigrahi/tripwise`. If it was renamed or moved, apply the bootstrap config again with `-var github_repo=<owner>/<name>`.

If the error is "Credentials could not be loaded" or the role ARN is empty, the variable is not set (step 4).
