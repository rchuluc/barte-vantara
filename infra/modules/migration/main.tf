resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name}-migrate"
  retention_in_days = 14
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-migration-execution"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}

resource "aws_iam_role_policy" "execution" {
  role = aws_iam_role.execution.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = var.repository_arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.this.arn}:*" },
    { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [var.master_secret_arn, var.runtime_secret_arn] }
  ] })
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name}-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  volume { name = "tmp" }
  container_definitions = jsonencode([{
    name             = "migrate", image = var.image, essential = true, user = "10001:10001", readonlyRootFilesystem = true,
    command          = ["--spring.profiles.active=migrate"],
    linuxParameters  = { initProcessEnabled = true, capabilities = { add = [], drop = ["ALL"] } },
    portMappings     = [], systemControls = [], volumesFrom = [],
    mountPoints      = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }],
    environment      = [{ name = "DB_URL", value = var.db_url }, { name = "DB_USER", value = "migrator" }, { name = "OTEL_TRACES_EXPORTER", value = "none" }],
    secrets          = [{ name = "DB_PASSWORD", valueFrom = "${var.master_secret_arn}:password::" }, { name = "APP_DB_PASSWORD", valueFrom = var.runtime_secret_arn }],
    logConfiguration = { logDriver = "awslogs", options = { awslogs-group = aws_cloudwatch_log_group.this.name, awslogs-region = var.region, awslogs-stream-prefix = "migration" } }
  }])
}
