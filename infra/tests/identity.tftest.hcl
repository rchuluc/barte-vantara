mock_provider "aws" {}

run "identity" {
  command = plan
  module { source = "./modules/identity" }
  variables {
    name              = "vantara-test"
    mcp_callback_urls = ["https://mcp.example.com/callback"]
  }
  assert {
    condition     = aws_cognito_user_pool.this.admin_create_user_config[0].allow_admin_create_user_only && aws_cognito_user_pool.this.deletion_protection == "ACTIVE"
    error_message = "Only admins may provision users and the pool must resist accidental deletion."
  }
  assert {
    condition     = aws_cognito_user_pool_client.web.prevent_user_existence_errors == "ENABLED" && aws_cognito_user_pool_client.web.access_token_validity == 15 && aws_cognito_user_pool_client.web.enable_token_revocation
    error_message = "Web authentication must resist enumeration and issue short-lived revocable tokens."
  }
  assert {
    condition     = aws_cognito_user_pool_client.mcp[0].allowed_oauth_flows == toset(["code"]) && !aws_cognito_user_pool_client.mcp[0].generate_secret
    error_message = "MCP must use delegated authorization code with PKCE, never client credentials."
  }
}

run "no_unregistered_mcp_client" {
  command = plan
  module { source = "./modules/identity" }
  variables { name = "vantara-test" }
  assert {
    condition     = length(aws_cognito_user_pool_client.mcp) == 0
    error_message = "Do not enable MCP without registered callbacks."
  }
}
