output "url" { value = "https://${aws_lb.this.dns_name}" }

output "cluster" { value = aws_ecs_cluster.this.name }

output "repositories" { value = { backend = module.backend.repository_url, frontend = module.frontend.repository_url } }

output "deploy_role_arns" { value = { for key, role in module.delivery : key => role.role_arn } }

output "migration_network" { value = { awsvpcConfiguration = { subnets = module.network.public_subnet_ids, securityGroups = [module.network.backend_security_group_id], assignPublicIp = "ENABLED" } } }
