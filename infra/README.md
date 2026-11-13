# AWS infrastructure

Modules: `network` (VPC, two public/two private subnets, restrictive SGs, S3
gateway endpoint); `data` (private PostgreSQL 17, S3, runtime secret); `service`
(ECR, ECS, scoped execution/task roles, health probes, Datadog); `migration`
(one-shot privileged deployment task); `delivery` (per-app GitHub OIDC roles).

## Static checks only

```sh
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
trivy config --severity HIGH,CRITICAL --exit-code 1 .
```

Tests use mocked providers and plan assertions; they make no AWS changes. They
check private/encrypted RDS, backups/deletion protection, S3 access controls,
network isolation, Fargate sizing, ECR immutability/scanning, and rollback.
This repository has not been applied. Provider lockfile is checked in.

Three resource-local Trivy exceptions document intentional design: the public
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

1. Provision an encrypted, versioned remote Terraform state backend with locking
   under your organization's controls. The local backend here is for validation
   only. The runtime database password is sensitive but **is stored in state**;
   configure remote state before any real apply.
2. Supply the existing account GitHub OIDC provider ARN, a validated regional ACM
   certificate, and a Secrets Manager secret containing the Datadog API key as
   plain text. Use AWS-managed Secrets Manager encryption, or extend execution
   policies with the exact KMS key if using a customer-managed key.
3. Copy `terraform.tfvars.example` to ignored `terraform.tfvars`. Bootstrap ECR
   repositories first with an operator-reviewed targeted plan for
   `module.backend.aws_ecr_repository.this` and `module.frontend.aws_ecr_repository.this`.
   Build/scan/push initial x86_64 app images; fill in their immutable digest URLs.
4. Review the full plan with `desired_count=0`, then apply it manually. This
   creates the RDS instance, task definitions and services without launching apps
   before their first migration. Configure GitHub environments below.
5. Execute the backend deployment after CI gates pass. It runs the migration to
   completion even at count zero. Then manually apply the intended desired count,
   and deploy both services. Use an operator with scoped migration permissions if
   bootstrapping before the foundation coverage gate is green; do not bypass CI.
6. Create DNS pointing your ACM-covered hostname to the ALB. The output ALB URL
   will not match a custom hostname certificate; use your configured hostname.

## GitHub environment configuration

Create protected `dev-backend` and `dev-frontend` environments; restrict deployment
branches to `main`. Each OIDC trust policy is bound to the exact repository and
app environment. Configure these **environment variables** (no static AWS keys):

| Variable | Value |
|---|---|
| AWS_REGION | Terraform region |
| AWS_DEPLOY_ROLE_ARN | app's `deploy_role_arns` output |
| ECR_REPOSITORY | `vantara-dev-backend` or `vantara-dev-frontend` |
| ECR_URL | app's `repositories` output |
| ECS_CLUSTER | `cluster` output |
| ECS_SERVICE | `vantara-dev-backend` or `vantara-dev-frontend` |
| MIGRATION_FAMILY | backend only: `vantara-dev-migrate` |
| MIGRATION_NETWORK | backend only: JSON from `terraform output -json migration_network` |

The workflow loads the image artifact already scanned by CI, pushes the SHA tag,
resolves its ECR digest, registers a task revision, and waits for service stability.
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
