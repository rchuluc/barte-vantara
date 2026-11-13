variable "name" { type = string }

variable "app" { type = string }

variable "image" { type = string }

variable "task_size" {
  description = "Fargate task CPU units and memory in MiB, including the Datadog sidecar."
  type = object({
    cpu    = number
    memory = number
  })
}

variable "port" { type = number }

variable "health_path" { type = string }

variable "health_command" { type = list(string) }

variable "cluster_id" { type = string }

variable "vpc_id" { type = string }

variable "subnet_ids" { type = list(string) }

variable "security_group_id" { type = string }

variable "region" { type = string }

variable "environment" { type = string }

variable "desired_count" { type = number }

variable "datadog_image" { type = string }

variable "datadog_site" { type = string }

variable "datadog_secret_arn" { type = string }

variable "namespace_id" { default = null }

variable "public_service" { default = false }

variable "load_balancer_arn" { default = null }

variable "certificate_arn" { default = null }

variable "bucket_arn" { default = null }

variable "environment_variables" { type = map(string) }

variable "secrets" {
  type    = map(string)
  default = {}
}
