terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  # Local state breaks the dependency on the bucket this root creates.
  backend "local" {}
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = "vantara", Environment = var.environment, ManagedBy = "terraform" } }
}
