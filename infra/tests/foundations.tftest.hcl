mock_provider "aws" {}
mock_provider "random" {}

run "private_encrypted_database_and_storage" {
  command = plan
  module { source = "./modules/data" }

  override_resource {
    target          = aws_s3_bucket.ingestion
    override_during = plan
    values = {
      id  = "vantara-test-ingestion"
      arn = "arn:aws:s3:::vantara-test-ingestion"
    }
  }

  variables {
    name                     = "vantara-test"
    vpc_id                   = "vpc-0123456789abcdef0"
    subnet_ids               = ["subnet-11111111", "subnet-22222222"]
    client_security_group_id = "sg-0123456789abcdef0"
    multi_az                 = false
  }
  assert {
    condition     = aws_db_instance.this.engine_version == "17" && aws_db_instance.this.storage_encrypted && !aws_db_instance.this.publicly_accessible
    error_message = "PostgreSQL 17 must be encrypted and private."
  }
  assert {
    condition     = aws_db_instance.this.backup_retention_period >= 7 && aws_db_instance.this.deletion_protection
    error_message = "Database must retain backups and prevent accidental deletion."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.this.block_public_acls && aws_s3_bucket_public_access_block.this.block_public_policy && aws_s3_bucket_public_access_block.this.ignore_public_acls && aws_s3_bucket_public_access_block.this.restrict_public_buckets
    error_message = "All S3 public access controls must be enabled."
  }
  assert {
    condition     = random_password.runtime.length >= 32 && !random_password.runtime.special
    error_message = "Runtime password must be strong and safe for migration placeholders."
  }

  assert {
    condition     = aws_s3_bucket_versioning.ingestion.versioning_configuration[0].status == "Enabled" && !aws_s3_bucket.ingestion.force_destroy
    error_message = "Ingestion evidence must retain immutable object versions and prevent forced deletion."
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.ingestion.block_public_acls && aws_s3_bucket_public_access_block.ingestion.block_public_policy && aws_s3_bucket_public_access_block.ingestion.ignore_public_acls && aws_s3_bucket_public_access_block.ingestion.restrict_public_buckets
    error_message = "Ingestion originals must never be public."
  }

  assert {
    condition     = length(one(aws_s3_bucket_lifecycle_configuration.ingestion.rule).noncurrent_version_expiration) == 0 && length(one(aws_s3_bucket_lifecycle_configuration.ingestion.rule).expiration) == 0
    error_message = "Evidence lifecycle must not expire original or referenced versions."
  }

  assert {
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.ingestion.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256" && jsondecode(aws_s3_bucket_policy.ingestion_tls.policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    error_message = "Evidence must be encrypted at rest and restricted to TLS transport."
  }
}

run "network_isolation" {
  command = plan
  module { source = "./modules/network" }
  variables {
    name   = "vantara-test"
    region = "us-east-1"
  }
  assert {
    condition     = length(aws_subnet.private) == 2 && length(aws_route_table.private.route) == 0
    error_message = "Database subnets must span two AZs with no Internet route."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.backend.from_port == 8080 && aws_vpc_security_group_ingress_rule.frontend.from_port == 3000
    error_message = "Only application ports should be open between application tiers."
  }
}

run "hardened_service" {
  command = plan
  module { source = "./modules/service" }

  override_resource {
    target          = aws_ecr_repository.this
    override_during = plan
    values = {
      arn = "arn:aws:ecr:us-east-1:123456789012:repository/vantara-test-frontend"
    }
  }

  override_resource {
    target          = aws_cloudwatch_log_group.this
    override_during = plan
    values = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/vantara-test-frontend"
    }
  }

  variables {
    name                  = "vantara-test-frontend"
    app                   = "frontend"
    image                 = "example.invalid/frontend@sha256:0123456789"
    task_size             = { cpu = 256, memory = 1024 }
    port                  = 3000
    health_path           = "/api/health"
    health_command        = ["CMD", "node", "health.js"]
    cluster_id            = "arn:aws:ecs:us-east-1:123456789012:cluster/test"
    vpc_id                = "vpc-0123456789abcdef0"
    subnet_ids            = ["subnet-11111111", "subnet-22222222"]
    security_group_id     = "sg-0123456789abcdef0"
    region                = "us-east-1"
    environment           = "test"
    desired_count         = 1
    datadog_image         = "public.ecr.aws/datadog/agent:7.73.0"
    datadog_site          = "datadoghq.com"
    datadog_secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:datadog-123456"
    environment_variables = { OPENROUTER_MODEL = "test/model" }
    secrets               = { OPENROUTER_API_KEY = "arn:aws:secretsmanager:us-east-1:123456789012:secret:openrouter-123456" }
    public_service        = true
    load_balancer_arn     = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/test/0123456789abcdef"
    certificate_arn       = "arn:aws:acm:us-east-1:123456789012:certificate/01234567-0123-0123-0123-012345678901"
  }
  assert {
    condition     = aws_ecs_task_definition.this.network_mode == "awsvpc" && aws_ecs_task_definition.this.cpu == "256" && aws_ecs_task_definition.this.memory == "1024"
    error_message = "Use valid, bounded Fargate sizing and awsvpc."
  }
  assert {
    condition     = aws_ecs_service.this.deployment_circuit_breaker[0].rollback && aws_ecs_service.this.deployment_minimum_healthy_percent == 100
    error_message = "Deployments must roll back and preserve healthy capacity."
  }
  assert {
    condition     = aws_ecr_repository.this.image_tag_mutability == "IMMUTABLE" && aws_ecr_repository.this.image_scanning_configuration[0].scan_on_push
    error_message = "Registry must scan images and prevent release tag overwrites."
  }

  assert {
    condition = (
      contains(jsondecode(aws_ecs_task_definition.this.container_definitions)[0].secrets, { name = "OPENROUTER_API_KEY", valueFrom = var.secrets.OPENROUTER_API_KEY }) &&
      contains(jsondecode(aws_ecs_task_definition.this.container_definitions)[0].environment, { name = "OPENROUTER_MODEL", value = "test/model" }) &&
      !contains([for item in jsondecode(aws_ecs_task_definition.this.container_definitions)[0].environment : item.name], "OPENROUTER_API_KEY")
    )
    error_message = "Inject the API key by secret reference, never as plaintext task configuration."
  }

  assert {
    condition     = contains(jsondecode(aws_iam_role_policy.execution.policy).Statement[3].Resource, var.secrets.OPENROUTER_API_KEY)
    error_message = "Only the execution role must be able to resolve the configured OpenRouter secret."
  }
}

run "backend_service" {
  command = plan
  module { source = "./modules/service" }

  variables {
    name                  = "vantara-test-backend"
    app                   = "backend"
    image                 = "example.invalid/backend@sha256:0123456789"
    task_size             = { cpu = 512, memory = 2048 }
    port                  = 8080
    health_path           = "/api/health"
    health_command        = ["CMD", "curl", "-fsS", "http://localhost:8080/api/health"]
    cluster_id            = "arn:aws:ecs:us-east-1:123456789012:cluster/test"
    vpc_id                = "vpc-0123456789abcdef0"
    subnet_ids            = ["subnet-11111111", "subnet-22222222"]
    security_group_id     = "sg-0123456789abcdef0"
    namespace_id          = "ns-0123456789abcdef0"
    region                = "us-east-1"
    environment           = "test"
    desired_count         = 1
    datadog_image         = "public.ecr.aws/datadog/agent:7.73.0"
    datadog_site          = "datadoghq.com"
    datadog_secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:datadog-123456"
    environment_variables = { DB_USER = "app_user" }
    secrets               = { DB_PASSWORD = "arn:aws:secretsmanager:us-east-1:123456789012:secret:database-123456" }
    bucket_arn            = "arn:aws:s3:::vantara-test"
    cognito_pool_arn      = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_test"
  }

  assert {
    condition     = aws_ecs_task_definition.this.family == "vantara-test-backend" && aws_ecs_task_definition.this.cpu == "512" && aws_ecs_task_definition.this.memory == "2048"
    error_message = "Backend must have its own task family and honor independently configured sizing."
  }

  assert {
    condition     = aws_ecs_service.this.name == "vantara-test-backend" && length(aws_ecs_service.this.load_balancer) == 0 && length(aws_ecs_service.this.service_registries) == 1
    error_message = "Backend must have its own private service with service discovery."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.identity[0].policy).Statement[0].Resource == var.cognito_pool_arn && length(jsondecode(aws_iam_role_policy.identity[0].policy).Statement[0].Action) == 3
    error_message = "Runtime Cognito mutations must be limited to its own user pool and the three required provisioning operations."
  }

  assert {
    condition     = toset(jsondecode(aws_iam_role_policy.storage[0].policy).Statement[1].Action) == toset(["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]) && jsondecode(aws_iam_role_policy.storage[0].policy).Statement[1].Resource == "${var.bucket_arn}/*"
    error_message = "Backend must read recorded versions without permission to delete evidence."
  }
}
