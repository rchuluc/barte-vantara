output "pool_id" { value = aws_cognito_user_pool.this.id }

output "pool_arn" { value = aws_cognito_user_pool.this.arn }

output "issuer" { value = "https://${aws_cognito_user_pool.this.endpoint}" }

output "client_id" { value = aws_cognito_user_pool_client.web.id }

output "mcp_client_id" { value = try(aws_cognito_user_pool_client.mcp[0].id, "") }
