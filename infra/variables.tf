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
  description = "Registered HTTPS callback URLs for delegated MCP OIDC; empty until a connection is configured."
  type        = list(string)
  default     = []
}
