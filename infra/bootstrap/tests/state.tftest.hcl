mock_provider "aws" {}

override_resource {
  target          = aws_s3_bucket.state
  override_during = plan
  values = {
    id  = "vantara-test-terraform-state"
    arn = "arn:aws:s3:::vantara-test-terraform-state"
  }
}

variables {
  state_bucket = "vantara-test-terraform-state"
}

run "protected_state_bucket" {
  command = plan

  assert {
    condition     = aws_s3_bucket.state.bucket == var.state_bucket && !aws_s3_bucket.state.force_destroy
    error_message = "Create the configured bucket without allowing deletion of its contents."
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.state.block_public_acls && aws_s3_bucket_public_access_block.state.block_public_policy && aws_s3_bucket_public_access_block.state.ignore_public_acls && aws_s3_bucket_public_access_block.state.restrict_public_buckets
    error_message = "State must block every form of public access."
  }

  assert {
    condition     = aws_s3_bucket_ownership_controls.state.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "ACLs must not grant access to state objects."
  }

  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "State versions must be retained for recovery."
  }

  assert {
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.state.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"
    error_message = "State must be encrypted at rest."
  }

  assert {
    condition = (
      jsondecode(aws_s3_bucket_policy.tls.policy).Statement[0].Effect == "Deny" &&
      jsondecode(aws_s3_bucket_policy.tls.policy).Statement[0].Principal == "*" &&
      jsondecode(aws_s3_bucket_policy.tls.policy).Statement[0].Action == "s3:*" &&
      toset(jsondecode(aws_s3_bucket_policy.tls.policy).Statement[0].Resource) == toset(["arn:aws:s3:::vantara-test-terraform-state", "arn:aws:s3:::vantara-test-terraform-state/*"]) &&
      jsondecode(aws_s3_bucket_policy.tls.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    )
    error_message = "All insecure S3 requests must be denied."
  }
}
