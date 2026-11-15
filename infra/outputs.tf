output "url" { value = "https://${aws_lb.this.dns_name}" }

output "cluster" { value = aws_ecs_cluster.this.name }

output "plan_role_arn" { value = module.planning.role_arn }

output "repositories" { value = { backend = module.backend.repository_url, frontend = module.frontend.repository_url } }

output "deploy_role_arns" { value = { for key, role in module.delivery : key => role.role_arn } }

output "migration_network" { value = { awsvpcConfiguration = { subnets = module.network.public_subnet_ids, securityGroups = [module.network.backend_security_group_id], assignPublicIp = "ENABLED" } } }

output "cognito_pool_id" { value = module.identity.pool_id }

output "cognito_client_id" { value = module.identity.client_id }

output "cognito_issuer" { value = module.identity.issuer }

output "cognito_mcp_client_id" { value = module.identity.mcp_client_id }
