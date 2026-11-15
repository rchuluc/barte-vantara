resource "aws_iam_role" "this" {
  name = "${var.name}-github-plan"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.environment}"
      } }
    }]
  })
}

resource "aws_iam_role_policy" "this" {
  role = aws_iam_role.this.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid    = "ReadInfrastructureMetadata"
        Effect = "Allow"
        Action = [
          "ec2:Describe*", "ecs:Describe*", "ecs:List*",
          "elasticloadbalancing:Describe*", "rds:Describe*", "rds:ListTagsForResource",
          "ecr:DescribeRepositories", "ecr:GetLifecyclePolicy", "ecr:ListTagsForResource",
          "logs:DescribeLogGroups", "logs:ListTagsForResource", "logs:ListTagsLogGroup",
          "iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "servicediscovery:GetNamespace", "servicediscovery:GetService", "servicediscovery:ListTagsForResource",
          "secretsmanager:DescribeSecret", "secretsmanager:ListSecretVersionIds",
          "budgets:ViewBudget", "budgets:Describe*", "budgets:ListTagsForResource",
          "s3:GetBucket*", "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration",
          "s3:GetAccelerateConfiguration", "s3:GetReplicationConfiguration",
          "s3:ListBucket", "sts:GetCallerIdentity"
        ]
        Resource = "*"
      },
      {
        Sid      = "ReadState"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::${var.state_bucket}/${var.state_key}"
      },
      {
        # Refreshing the managed secret version requires its value, also present in state.
        Sid      = "RefreshRuntimeSecret"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.runtime_secret_arn
      }
      ], var.state_kms_key_arn == null ? [] : [{
        Sid      = "DecryptState"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.state_kms_key_arn
    }])
  })
}
