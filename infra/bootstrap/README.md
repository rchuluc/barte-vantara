# Terraform state bootstrap

This standalone root module creates the S3 backend bucket used by `infra`.
It runs separately with local state so bucket creation does not depend on an
already-existing S3 backend. It is not called by the main stack.

The bucket has versioning, SSE-S3 encryption, enforced bucket ownership (ACLs
disabled), all public-access blocks, and a TLS-only bucket policy. Terraform
`prevent_destroy` blocks deletion/replacement while the resource remains in the
configuration; `force_destroy = false` prevents purging a nonempty bucket. State
versions are retained without automatic expiration.

## Create the bucket (operator-run)

Run from the repository root with Terraform >=1.10 and operator AWS credentials:

```sh
cp infra/bootstrap/terraform.tfvars.example infra/bootstrap/terraform.tfvars
# Set state_bucket to a globally unique lowercase bucket name and choose the region.
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
```

Keep `infra/bootstrap/terraform.tfstate` and its backup in your organization's
secure backup storage. They are ignored by Git and must be retained to manage
the bucket. Run future bootstrap operations from that same state. If a bucket
already exists, import it and its existing configuration into this root rather
than attempting to create or manage it in two stacks.

## Initialize the main stack

Set `state_bucket` in `infra/terraform.tfvars` to the bootstrap output and set
`state_key` to `vantara/dev/terraform.tfstate` (or your chosen key). Leave
`state_kms_key_arn` unset for this SSE-S3 bucket.

```sh
terraform -chdir=infra init \
  -backend-config="bucket=$(terraform -chdir=infra/bootstrap output -raw state_bucket)" \
  -backend-config="region=$(terraform -chdir=infra/bootstrap output -raw state_region)" \
  -backend-config="key=vantara/dev/terraform.tfstate"
```

For an existing main-stack local state, back it up and add `-migrate-state` to
that command. The main backend enables native S3 lockfiles (`use_lockfile = true`),
so no DynamoDB table is required. Operators need read/write access to the state
object and read/write/delete access to its `.tflock` object. The PR planning role
remains read-only and plans without a lock.

Use the bucket and region outputs for `TF_STATE_BUCKET` and `TF_STATE_REGION`
in the `dev-plan` GitHub environment. Set `TF_STATE_KEY` to the main state's key.

## Static verification

```sh
terraform -chdir=infra/bootstrap init -backend=false -lockfile=readonly
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/bootstrap test
```

CI and `npm run infra:test` validate both roots using mocked tests. Live PR plans
cover the main stack only; bootstrap changes require an operator-reviewed plan
using the bootstrap local state. CI does not apply either root.
