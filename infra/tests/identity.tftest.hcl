mock_provider "aws" {}

run "identity" {
  command = plan
  module { source = "./modules/identity" }
  variables {
    name              = "vantara-test"
    mcp_callback_urls = ["https://mcp.example.com/callback"]
    mcp_resource_urls = ["https://workspace.example.com/api/mcp"]
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

  assert {
    condition     = alltrue([for attribute in ["email", "email_verified"] : contains(aws_cognito_user_pool_client.mcp[0].read_attributes, attribute)])
    error_message = "Cognito's email scope requires read access to email and email_verified or token exchange fails with invalid_grant."
  }

  assert {
    condition     = aws_cognito_user_pool_domain.this[0].managed_login_version == 2
    error_message = "MCP resource-bound access tokens require managed login, not classic hosted UI."
  }

  assert {
    condition     = aws_cognito_managed_login_branding.mcp[0].use_cognito_provided_values
    error_message = "API-created MCP clients need a branding style to render managed login."
  }

  assert {
    condition     = aws_cognito_resource_server.mcp["https://workspace.example.com/api/mcp"].identifier == "https://workspace.example.com/api/mcp"
    error_message = "Register the exact MCP audience; unregistered resource binding fails at Cognito token exchange."
  }
}

run "no_unregistered_mcp_client" {
  command = plan
  module { source = "./modules/identity" }
  variables {
    name              = "vantara-test"
    mcp_callback_urls = []
  }
  assert {
    condition     = length(aws_cognito_user_pool_client.mcp) == 0
    error_message = "Do not enable MCP without registered callbacks."
  }
}

run "opencode_loopback_callback" {
  command = plan
  module { source = "./modules/identity" }
  variables {
    name              = "vantara-test"
    mcp_callback_urls = ["http://127.0.0.1:19876/callback"]
  }
  assert {
    condition     = aws_cognito_user_pool_client.mcp[0].callback_urls == toset(["http://127.0.0.1:19876/callback"])
    error_message = "OpenCode must receive codes only at its registered loopback listener."
  }
}

run "reject_remote_plaintext_callback" {
  command = plan
  module { source = "./modules/identity" }
  variables {
    name              = "vantara-test"
    mcp_callback_urls = ["http://localhost.evil.example:19876/callback"]
  }
  expect_failures = [var.mcp_callback_urls]
}
