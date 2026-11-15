locals { name = "vantara-${var.environment}" }

module "planning" {
  source             = "./modules/planning"
  name               = local.name
  github_repository  = var.github_repository
  environment        = "${var.environment}-plan"
  oidc_provider_arn  = var.github_oidc_provider_arn
  state_bucket       = var.state_bucket
  state_key          = var.state_key
  state_kms_key_arn  = var.state_kms_key_arn
  runtime_secret_arn = module.data.runtime_secret_arn
}

module "network" {
  source = "./modules/network"
  name   = local.name
  region = var.region
}

module "data" {
  source                   = "./modules/data"
  name                     = local.name
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.private_subnet_ids
  client_security_group_id = module.network.backend_security_group_id
  multi_az                 = var.multi_az
}

resource "aws_ecs_cluster" "this" { name = local.name }

resource "aws_service_discovery_private_dns_namespace" "this" {
  name = "${local.name}.internal"
  vpc  = module.network.vpc_id
}

# Intentional public entry point; TLS listener, HTTP redirect and tier-scoped SGs.
# trivy:ignore:AVD-AWS-0053
resource "aws_lb" "this" {
  name                       = local.name
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [module.network.alb_security_group_id]
  subnets                    = module.network.public_subnet_ids
  drop_invalid_header_fields = true
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

module "backend" {
  source                = "./modules/service"
  name                  = "${local.name}-backend"
  app                   = "backend"
  image                 = var.backend_image
  task_size             = var.backend_task_size
  port                  = 8080
  health_path           = "/api/health"
  health_command        = ["CMD", "curl", "-fsS", "http://localhost:8080/api/health"]
  cluster_id            = aws_ecs_cluster.this.id
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.public_subnet_ids
  security_group_id     = module.network.backend_security_group_id
  namespace_id          = aws_service_discovery_private_dns_namespace.this.id
  region                = var.region
  environment           = var.environment
  desired_count         = var.desired_count
  datadog_image         = var.datadog_image
  datadog_site          = var.datadog_site
  datadog_secret_arn    = var.datadog_api_key_secret_arn
  environment_variables = { DB_URL = "jdbc:postgresql://${module.data.endpoint}/vantara?sslmode=require", DB_USER = "app_user" }
  secrets               = { DB_PASSWORD = module.data.runtime_secret_arn }
  bucket_arn            = module.data.bucket_arn
}

module "frontend" {
  source                = "./modules/service"
  name                  = "${local.name}-frontend"
  app                   = "frontend"
  image                 = var.frontend_image
  task_size             = var.frontend_task_size
  port                  = 3000
  health_path           = "/api/health"
  health_command        = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  cluster_id            = aws_ecs_cluster.this.id
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.public_subnet_ids
  security_group_id     = module.network.frontend_security_group_id
  region                = var.region
  environment           = var.environment
  desired_count         = var.desired_count
  datadog_image         = var.datadog_image
  datadog_site          = var.datadog_site
  datadog_secret_arn    = var.datadog_api_key_secret_arn
  public_service        = true
  load_balancer_arn     = aws_lb.this.arn
  certificate_arn       = var.certificate_arn
  environment_variables = { HOSTNAME = "0.0.0.0", BACKEND_URL = "http://backend.${aws_service_discovery_private_dns_namespace.this.name}:8080" }
}

module "migration" {
  source             = "./modules/migration"
  name               = local.name
  region             = var.region
  image              = var.backend_image
  repository_arn     = module.backend.repository_arn
  db_url             = "jdbc:postgresql://${module.data.endpoint}/vantara?sslmode=require"
  master_secret_arn  = module.data.master_secret_arn
  runtime_secret_arn = module.data.runtime_secret_arn
}

module "delivery" {
  for_each          = toset(["backend", "frontend"])
  source            = "./modules/delivery"
  name              = "${local.name}-${each.key}"
  app               = each.key
  github_repository = var.github_repository
  environment       = var.environment
  oidc_provider_arn = var.github_oidc_provider_arn
  repository_arn    = each.key == "backend" ? module.backend.repository_arn : module.frontend.repository_arn
  service_arn       = each.key == "backend" ? module.backend.service_arn : module.frontend.service_arn
  task_role_arns    = concat(each.key == "backend" ? module.backend.role_arns : module.frontend.role_arns, each.key == "backend" ? module.migration.role_arns : [])
  cluster_arn       = aws_ecs_cluster.this.arn
  migration_family  = "${local.name}-migrate"
}

resource "aws_budgets_budget" "monthly" {
  name         = local.name
  budget_type  = "COST"
  limit_amount = var.monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
}
