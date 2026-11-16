# AWS infrastructure

Modules: `network` (VPC, two public/two private subnets, restrictive SGs, S3
gateway endpoint); `data` (private PostgreSQL 17, S3, runtime secret); `service`
(ECR, ECS, scoped execution/task roles, health probes, Datadog); `migration`
(one-shot privileged deployment task); `delivery` (per-app GitHub OIDC roles);
`planning` (read-only GitHub OIDC role for infrastructure plans); `identity`
(admin-provisioned Cognito user pool, web client and optional delegated MCP client).

Identity settings are wired into the backend ECS task. The task role can create,
set a password on, and compensate deletion of users only in that pool. It cannot
manage pools, clients, roles or approval grants. Local seed users never enter
Terraform/state. Configure `mcp_callback_urls` with registered HTTPS callbacks to
enable the separate authorization-code client; the adapter must use PKCE. Its
client ID is classified as AI-originated by the backend. See
[backend identity contract](../apps/backend/AUTH.md).

The standalone [`bootstrap`](bootstrap/README.md) root creates the S3 state bucket
before the main stack initializes; it maintains separate local state.

## Static checks only

```sh
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
terraform -chdir=bootstrap init -backend=false -lockfile=readonly
terraform -chdir=bootstrap validate
terraform -chdir=bootstrap test
trivy config --severity HIGH,CRITICAL --exit-code 1 .
```

For an already initialized remote-state checkout, set `TF_DATA_DIR` to a fresh
temporary directory for all static commands above so initialization does not
reuse remote backend metadata.

Tests use mocked providers and plan assertions; they make no AWS changes. They
check private/encrypted RDS, backups/deletion protection, S3 access controls,
network isolation, Fargate sizing, ECR immutability/scanning, and rollback.
This repository has not been applied. Provider lockfile is checked in.

Resource-local Trivy exceptions document intentional design: the public
ALB (AWS-0053), outbound TCP 443 for dynamic AWS/Datadog endpoints (AWS-0104), and
SSE-S3 instead of a billable customer KMS key (AWS-0132). They do not suppress
container CVEs or broadly ignore other findings. Reassess these for production.

## Cost model

Defaults target a small development environment: a 0.5-vCPU/1-GiB backend task
and a 0.25-vCPU/1-GiB frontend task (each includes Datadog), one db.t4g.micro,
20-GiB gp3, one ALB, 14-day application
logs, 20 ECR images, and 30-day noncurrent S3 expiration. An account-wide monthly
forecast budget alerts at 80% of $150; this is an alert, not a spending cap.

Each app has its own ECS service and task definition through the `backend` and
`frontend` instances of the service module. Configure their sizes independently
in `terraform.tfvars` (CPU units and memory in MiB, including the sidecar):

```hcl
backend_task_size  = { cpu = 512, memory = 1024 }
frontend_task_size = { cpu = 256, memory = 1024 }
```

Use valid AWS Fargate CPU/memory combinations when overriding these sizes.

Tasks have public IPv4 addresses for outbound ECR/Datadog access, but their SGs
permit inbound traffic **only from the previous tier's SG**. RDS subnets have no
Internet route. This avoids a NAT gateway's fixed cost. Public IPv4, ALB hours/LCU,
CloudWatch, RDS backup/storage and Datadog subscriptions still cost money. Use the
AWS pricing calculator for your region before applying; $150 is not an estimate.
For production availability, set `multi_az=true` and `desired_count=2`, and revisit
private app subnets/NAT/endpoints according to budget and isolation requirements.

## Bootstrap (operator-run, not executed here)

1. Create the encrypted, versioned S3 state bucket with the standalone
   [`bootstrap` root](bootstrap/README.md), retaining its local state securely.
   Terraform >=1.10 is required for S3 lockfiles.
   The partial backend in `versions.tf` enables encryption and locking. Initialize
   it with `terraform -chdir=infra init -backend-config="bucket=BUCKET"
   -backend-config="key=vantara/dev/terraform.tfstate" -backend-config="region=us-east-1"`
   (one command). Use matching `state_bucket` and `state_key` variables.
   If existing state is local, use operator-reviewed `init -migrate-state` with
   those backend arguments and retain a backup. Do not initialize an empty remote
   state over an existing deployment. The runtime database password **is stored
   in state**. Static checks still use `init -backend=false`.
2. Supply the existing account GitHub OIDC provider ARN, a validated regional ACM
   certificate, and a Secrets Manager secret containing the Datadog API key as
   plain text. Use AWS-managed Secrets Manager encryption, or extend execution
   policies with the exact KMS key if using a customer-managed key.
3. Copy `terraform.tfvars.example` to ignored `terraform.tfvars`. Bootstrap ECR
   repositories first with an operator-reviewed targeted plan for
   `module.backend.aws_ecr_repository.this` and `module.frontend.aws_ecr_repository.this`.
    For pipeline-built initial images, also target
    `module.delivery["backend"].aws_iam_role_policy.publish` and
    `module.delivery["frontend"].aws_iam_role_policy.publish`. These create the
    OIDC roles and repository-scoped publishing permissions without ECS dependencies.
    Configure the `prod-backend` and `prod-frontend` GitHub environments with the
    region, role ARN, repository name, and repository URL below. Restrict them to
    `main`. The CD workflows always check, build, scan, publish, and deploy; they
    report immutable image digest URLs in the job summary. On a fresh environment,
    the first run can publish images before ECS exists and fail at deployment.
    Fill in those digest URLs in tfvars, complete the infrastructure and initial
    migration below, then rerun the workflows to deploy.
4. Review the full plan with `desired_count=0`, then apply it manually. This
   creates the RDS instance, task definitions and services without launching apps
   before their first migration. Configure GitHub environments below.
5. Run the initial migration with an operator using scoped migration permissions,
   verify exit code zero, then manually apply the intended positive desired count
   and deploy both services after CI gates pass. CD requires healthy running
   capacity and will reject a service with desired count zero; do not bypass CI.
6. Create DNS pointing your ACM-covered hostname to the ALB. The output ALB URL
   will not match a custom hostname certificate; use your configured hostname.

## GitHub environment configuration

Create protected `prod-backend` and `prod-frontend` environments; restrict deployment
branches to `main`. Each OIDC trust policy is bound to the exact repository and
app environment. Configure these **environment variables** (no static AWS keys):

Verify `gh api repos/OWNER/REPO/actions/oidc/customization/sub` before applying
roles. Set `github_repository` to the returned `sub_claim_prefix` without `repo:`
when immutable subjects are enabled (for example, `OWNER@123/REPO@456`); otherwise
use `OWNER/REPO`. Both deployment and planning trust policies use this identity.

| Variable | Value |
|---|---|
| AWS_REGION | Terraform region |
| AWS_DEPLOY_ROLE_ARN | app's `deploy_role_arns` output |
| ECR_REPOSITORY | `vantara-prod-backend` or `vantara-prod-frontend` |
| ECR_URL | app's `repositories` output |
| ECS_CLUSTER | `cluster` output |
| ECS_SERVICE | `vantara-prod-backend` or `vantara-prod-frontend` |
| MIGRATION_FAMILY | backend only: `vantara-prod-migrate` |
| MIGRATION_NETWORK | backend only: JSON from `terraform output -json migration_network` |

Each CD workflow runs application checks, builds an amd64 image, runs Trivy and
Dive, then publishes that exact local image using a unique SHA/run/attempt tag.
It resolves the ECR digest, registers a task revision, and waits for service stability.
Backend deployment first registers/runs the migration image at the same digest;
nonzero/missing exit status blocks rollout. Circuit-breaker rollback is checked
explicitly rather than treating an old stable revision as successful deployment.
The deployment role cannot access database passwords directly. Only the migration
execution role can read the managed RDS master secret; runtime gets only its own
password. Frontend has no database or S3 permissions.

Terraform ignores service `task_definition` changes because CI owns release
revisions. After changing a task template (environment, sidecar, sizing, secrets),
apply the infrastructure then explicitly update the service to the new Terraform
task revision, or use that new revision as the deployment template. Otherwise a
CI deployment based on the running revision retains the previous configuration.
Migrations are expand/contract; ECS rollback never undoes committed SQL changes.

## OpenRouter runtime configuration

Set the optional `openrouter` object in deployment tfvars with `model` and
`api_key_secret_arn`. Store the API key itself as a plain string in AWS Secrets
Manager. Terraform injects `OPENROUTER_MODEL` as a server environment variable and
`OPENROUTER_API_KEY` through ECS secrets, granting the execution role access to that
secret. Neither value is a Next.js public variable or a Docker build argument.

Apply the updated frontend task template and point the service at that revision
before the next image release, as described above. CD clones the running task
definition, preserving both settings. Include the object in the `prod-plan`
environment's `TF_VARS_JSON` too. Secret rotation takes effect on newly launched tasks.

## Live infrastructure PR plans


Bootstrap/apply the `planning` module with an operator before enabling live plans.
Create a **protected `prod-plan` environment with required reviewers**; review the
PR's Terraform and workflow changes before approving its job. Its OIDC trust is
bound to that environment, not to the app deployment environments. Access to state
and the managed runtime secret exposes database credentials, so only trusted PR
code may receive this role. Fork and Dependabot PRs never assume it.

Configure these variables in `prod-plan`:

| Variable | Value |
|---|---|
| AWS_REGION | Infrastructure AWS region |
| AWS_PLAN_ROLE_ARN | `plan_role_arn` Terraform output |
| TF_STATE_BUCKET | Existing S3 state bucket, matching `state_bucket` |
| TF_STATE_KEY | Existing default-workspace state object key, matching `state_key` |
| TF_STATE_REGION | State bucket's region |

Set environment secret `TF_VARS_JSON` to the full deployment variable map in JSON
(the values from your real tfvars, including current image digests and sizing).
The workflow explicitly supplies `state_bucket` and `state_key` from the backend
variables. For SSE-KMS state, set `state_kms_key_arn` to grant scoped decrypt access;
the KMS key policy must also permit the role. This workflow uses the default
Terraform workspace only.

The plan role can read infrastructure metadata, the exact state object, and the
runtime secret version Terraform manages. It cannot apply, publish images, deploy
services, or write state. PR plans use `-lock=false` to keep the role read-only;
they are speculative and may race operator changes. Operators must create a fresh
locked plan before applying. The workflow refuses missing state, treats exit 2
as a successful plan with changes, and fails on plan errors.

The sticky PR comment reports validation and plan status plus resource action
counts (replacements count as both add and destroy). Raw plans, state, and input
values are neither posted nor uploaded; temporary plan files are removed. Errors
fail the job without printing potentially sensitive provider diagnostics. Inspect
permissions/configuration or reproduce the plan as an authorized operator to debug.
Validation failures still receive a comment. Fork/Dependabot PRs get a job summary
without a comment because their tokens are read-only.

## Datadog and logging

Each task runs a non-root Datadog agent with OTLP HTTP on localhost:4318.
Spring's OpenTelemetry starter and Next's instrumentation export traces there;
the agent collects Fargate task metrics. Logs are structured stdout to CloudWatch,
retained for 14 days. Configure the Datadog AWS integration and its standard
CloudWatch log forwarder subscriptions for `/ecs/vantara-*` to ingest logs into
Datadog. The forwarder and Datadog account are organization-level prerequisites,
not provisioned in this stack. No live Datadog ingestion was verified locally.

Keep Datadog API keys in Secrets Manager, never tfvars. Rotation requires new
tasks because ECS injects secrets only at startup. Configure dashboards/alerts
for error rate, latency, unhealthy ECS tasks, database connections and budget.
