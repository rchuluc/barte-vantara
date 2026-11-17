variable "region" { default = "us-east-1" }

variable "state_bucket" {
  description = "Existing encrypted, versioned S3 backend bucket (bootstrapped outside this stack)."
  type        = string
}

variable "state_key" {
  description = "S3 state object key, also supplied to terraform init."
  type        = string
  default     = "vantara/dev/terraform.tfstate"
}

variable "state_kms_key_arn" {
  description = "Optional customer-managed KMS key for the backend; null for SSE-S3."
  type        = string
  default     = null
}

variable "environment" { default = "dev" }

variable "github_repository" {
  description = "Repository identity in the GitHub OIDC subject: ORG/REPO, or ORG@OWNER_ID/REPO@REPO_ID for immutable subjects."
  type        = string
}

variable "certificate_arn" { type = string }

variable "datadog_api_key_secret_arn" { type = string }

variable "datadog_site" { default = "datadoghq.com" }

variable "datadog_image" { default = "public.ecr.aws/datadog/agent:7.73.0" }

variable "backend_image" { type = string }

variable "frontend_image" { type = string }

variable "openrouter" {
  description = "Optional server-side assistant configuration. Store the API key in Secrets Manager, never in Terraform variables."
  type = object({
    model              = string
    api_key_secret_arn = string
  })
  default = null

  validation {
    condition = var.openrouter == null ? true : (
      length(trimspace(var.openrouter.model)) > 0 &&
      can(regex("^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:.+$", var.openrouter.api_key_secret_arn))
    )
    error_message = "OpenRouter requires a model and a Secrets Manager API-key ARN."
  }
}

variable "tenant_not_found_redirect_url" {
  description = "Optional absolute HTTP(S) URL for browser requests with no matching tenant; empty preserves 404 responses."
  type        = string
  default     = ""
}

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

variable "mcp_callback_urls" {
  description = "Registered HTTPS or local loopback callback URLs for delegated MCP OIDC; empty until a connection is configured."
  type        = list(string)
  default     = []
}

variable "mcp_resource_urls" {
  description = "Exact HTTPS MCP endpoint URLs registered as Cognito resource audiences."
  type        = set(string)
  default     = []
}
