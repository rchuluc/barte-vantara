variable "region" { default = "us-east-1" }

variable "environment" { default = "dev" }

variable "github_repository" { type = string }

variable "certificate_arn" { type = string }

variable "datadog_api_key_secret_arn" { type = string }

variable "datadog_site" { default = "datadoghq.com" }

variable "datadog_image" { default = "public.ecr.aws/datadog/agent:7.73.0" }

variable "backend_image" { type = string }

variable "frontend_image" { type = string }

variable "backend_task_size" {
  description = "Backend Fargate task size, including Datadog (CPU units / MiB)."
  type = object({
    cpu    = number
    memory = number
  })
  default = { cpu = 512, memory = 1024 }
}

variable "frontend_task_size" {
  description = "Frontend Fargate task size, including Datadog (CPU units / MiB)."
  type = object({
    cpu    = number
    memory = number
  })
  default = { cpu = 256, memory = 1024 }
}

variable "desired_count" { default = 1 }

variable "multi_az" { default = false }

variable "budget_email" { type = string }

variable "monthly_budget_usd" { default = "150" }

variable "github_oidc_provider_arn" {
  description = "Existing account-level GitHub OIDC provider; create once outside this stack."
  type        = string
}
