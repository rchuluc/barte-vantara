mock_provider "aws" {}

run "production_image_publishing" {
  command = plan
  module { source = "./modules/delivery" }

  variables {
    name              = "vantara-prod-backend"
    app               = "backend"
    environment       = "prod"
    github_repository = "example@123/vantara@456"
    oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    repository_arn    = "arn:aws:ecr:us-east-1:123456789012:repository/vantara-prod-backend"
    service_arn       = "arn:aws:ecs:us-east-1:123456789012:service/vantara-prod/vantara-prod-backend"
    cluster_arn       = "arn:aws:ecs:us-east-1:123456789012:cluster/vantara-prod"
    task_role_arns    = ["arn:aws:iam::123456789012:role/vantara-prod-backend-task"]
    migration_family  = "vantara-prod-migrate"
  }

  assert {
    condition     = jsondecode(aws_iam_role.this.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:example@123/vantara@456:environment:prod-backend"
    error_message = "Production publishing must trust only the matching repository environment."
  }

  assert {
    condition     = jsondecode(aws_iam_role.this.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    error_message = "OIDC tokens must be intended for AWS STS."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.publish.policy).Statement :
      statement.Resource == "*" ? statement.Action == ["ecr:GetAuthorizationToken"] : statement.Resource == var.repository_arn
    ])
    error_message = "Publishing may write only the app repository; only ECR login is account-wide."
  }

  assert {
    condition = alltrue(flatten([
      for statement in jsondecode(aws_iam_role_policy.publish.policy).Statement : [
        for action in statement.Action : startswith(action, "ecr:")
      ]
    ]))
    error_message = "Bootstrapped publishing permissions must not grant deployment or secret access."
  }
}
