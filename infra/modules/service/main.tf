locals {
  trust   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
  logging = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.this.name, awslogs-region = var.region, awslogs-stream-prefix = "ecs", mode = "non-blocking", max-buffer-size = "10m" } }
}

resource "aws_ecr_repository" "this" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy     = jsonencode({ rules = [{ rulePriority = 1, description = "Keep 20 releases", selection = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }, action = { type = "expire" } }] })
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}"
  retention_in_days = 14
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = local.trust
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = local.trust
}

resource "aws_iam_role_policy" "execution" {
  role = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = aws_ecr_repository.this.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.this.arn}:*" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = concat(values(var.secrets), [var.datadog_secret_arn]) }
  ] })
}

resource "aws_iam_role_policy" "storage" {
  count = var.app == "backend" ? 1 : 0
  role  = aws_iam_role.task.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = var.bucket_arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], Resource = "${var.bucket_arn}/*" }
  ] })
}

resource "aws_iam_role_policy" "identity" {
  count = var.app == "backend" ? 1 : 0
  role  = aws_iam_role.task.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    {
      Effect   = "Allow"
      Action   = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminSetUserPassword", "cognito-idp:AdminDeleteUser"]
      Resource = var.cognito_pool_arn
    }
  ] })
}

resource "aws_lb_target_group" "this" {
  count                = var.public_service ? 1 : 0
  name                 = var.name
  port                 = var.port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 30
  health_check {
    path                = var.health_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_service_discovery_service" "this" {
  count = var.app == "backend" ? 1 : 0
  name  = var.app
  dns_config {
    namespace_id = var.namespace_id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }
  health_check_custom_config { failure_threshold = 1 }
}

resource "aws_lb_listener" "https" {
  count             = var.public_service ? 1 : 0
  load_balancer_arn = var.load_balancer_arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[0].arn
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_size.cpu
  memory                   = var.task_size.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  volume { name = "tmp" }
  container_definitions = jsonencode([
    {
      name                   = var.app, image = var.image, essential = true, user = var.app == "backend" ? "10001:10001" : "1000:1000",
      readonlyRootFilesystem = true, stopTimeout = 35,
      linuxParameters        = { initProcessEnabled = true, capabilities = { add = [], drop = ["ALL"] } },
      portMappings           = [{ containerPort = var.port, hostPort = var.port, protocol = "tcp" }],
      systemControls         = [], volumesFrom = [],
      mountPoints            = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }],
      environment = [for k, v in merge(var.environment_variables, {
        OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318",
        OTEL_EXPORTER_OTLP_PROTOCOL = "http/protobuf",
        OTEL_RESOURCE_ATTRIBUTES    = "deployment.environment.name=${var.environment}",
        DD_ENV                      = var.environment, DD_SERVICE = var.name
      }) : { name = k, value = v }],
      secrets          = [for k, v in var.secrets : { name = k, valueFrom = v }],
      healthCheck      = { command = var.health_command, interval = 15, timeout = 5, retries = 3, startPeriod = 120 },
      logConfiguration = local.logging,
      dockerLabels     = { "com.datadoghq.tags.service" = var.name, "com.datadoghq.tags.env" = var.environment }
    },
    {
      name        = "datadog", image = var.datadog_image, essential = true, user = "dd-agent",
      cpu         = 64, memoryReservation = 256,
      mountPoints = [], portMappings = [], systemControls = [], volumesFrom = [],
      environment = [for k, v in {
        ECS_FARGATE              = "true", DD_SITE = var.datadog_site, DD_ENV = var.environment,
        DD_APM_ENABLED           = "true", DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT = "0.0.0.0:4318",
        DD_PROCESS_AGENT_ENABLED = "false", DD_LOGS_ENABLED = "false"
      } : { name = k, value = v }],
      secrets          = [{ name = "DD_API_KEY", valueFrom = var.datadog_secret_arn }],
      logConfiguration = local.logging
    }
  ])
}

resource "aws_ecs_service" "this" {
  name                               = var.name
  cluster                            = var.cluster_id
  task_definition                    = aws_ecs_task_definition.this.arn
  desired_count                      = var.desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  health_check_grace_period_seconds  = var.public_service ? 120 : null
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.security_group_id]
    assign_public_ip = true
  }
  dynamic "load_balancer" {
    for_each = var.public_service ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.this[0].arn
      container_name   = var.app
      container_port   = var.port
    }
  }
  dynamic "service_registries" {
    for_each = var.app == "backend" ? [1] : []
    content { registry_arn = aws_service_discovery_service.this[0].arn }
  }
  # CI owns release revisions; Terraform owns task templates and service configuration.
  lifecycle { ignore_changes = [task_definition] }
  depends_on = [aws_iam_role_policy.execution, aws_lb_listener.https]
}
