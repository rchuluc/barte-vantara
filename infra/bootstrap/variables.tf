variable "region" { default = "us-east-1" }

variable "environment" { default = "dev" }

variable "state_bucket" {
  description = "Globally unique name of the S3 bucket for Terraform state."
  type        = string
}
