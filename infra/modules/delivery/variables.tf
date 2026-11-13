variable "name" { type = string }

variable "app" { type = string }

variable "github_repository" { type = string }

variable "environment" { type = string }

variable "oidc_provider_arn" { type = string }

variable "repository_arn" { type = string }

variable "service_arn" { type = string }

variable "task_role_arns" { type = list(string) }

variable "cluster_arn" { type = string }

variable "migration_family" { type = string }
