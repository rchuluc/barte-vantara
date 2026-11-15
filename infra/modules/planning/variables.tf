variable "name" { type = string }

variable "github_repository" { type = string }

variable "environment" { type = string }

variable "oidc_provider_arn" { type = string }

variable "state_bucket" { type = string }

variable "state_key" { type = string }

variable "state_kms_key_arn" {
  type    = string
  default = null
}

variable "runtime_secret_arn" { type = string }
