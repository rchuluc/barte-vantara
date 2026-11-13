mock_provider "aws" {}
mock_provider "random" {}

run "private_encrypted_database_and_storage" {
  command = plan
  module { source = "./modules/data" }
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
    environment_variables = {}
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
  }

  assert {
    condition     = aws_ecs_task_definition.this.family == "vantara-test-backend" && aws_ecs_task_definition.this.cpu == "512" && aws_ecs_task_definition.this.memory == "2048"
    error_message = "Backend must have its own task family and honor independently configured sizing."
  }

  assert {
    condition     = aws_ecs_service.this.name == "vantara-test-backend" && length(aws_ecs_service.this.load_balancer) == 0 && length(aws_ecs_service.this.service_registries) == 1
    error_message = "Backend must have its own private service with service discovery."
  }
}
