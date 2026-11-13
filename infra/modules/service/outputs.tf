output "target_group_arn" { value = try(aws_lb_target_group.this[0].arn, null) }

output "repository_arn" { value = aws_ecr_repository.this.arn }

output "repository_url" { value = aws_ecr_repository.this.repository_url }

output "service_arn" { value = aws_ecs_service.this.id }

output "role_arns" { value = [aws_iam_role.task.arn, aws_iam_role.execution.arn] }
