mock_provider "aws" {}

run "read_only_planning" {
  command = plan
  module { source = "./modules/planning" }

  variables {
    name               = "vantara-test"
    github_repository  = "example/vantara"
    environment        = "dev-plan"
    oidc_provider_arn  = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    state_bucket       = "example-state"
    state_key          = "vantara/dev/terraform.tfstate"
    runtime_secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:runtime-123456"
  }

  assert {
    condition     = jsondecode(aws_iam_role.this.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:example/vantara:environment:dev-plan"
    error_message = "Only the protected plan environment may assume the role."
  }

  assert {
    condition = alltrue(flatten([
      for statement in jsondecode(aws_iam_role_policy.this.policy).Statement : [
        for action in statement.Action : can(regex(":(Get|List|Describe|View)", action))
      ]
    ]))
    error_message = "Planning must not mutate AWS resources or state."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.this.policy).Statement[1].Resource == "arn:aws:s3:::example-state/vantara/dev/terraform.tfstate"
    error_message = "State object reads must be scoped to the configured backend key."
  }

  assert {
    condition     = jsondecode(aws_iam_role_policy.this.policy).Statement[2].Resource == var.runtime_secret_arn
    error_message = "Secret value reads must be limited to the managed runtime secret."
  }
}
