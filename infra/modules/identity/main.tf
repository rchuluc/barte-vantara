resource "aws_cognito_user_pool" "this" {
  name                = var.name
  deletion_protection = "ACTIVE"
  username_attributes = ["email"]

  username_configuration { case_sensitive = false }

  admin_create_user_config { allow_admin_create_user_only = true }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 1
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name                          = "${var.name}-web"
  user_pool_id                  = aws_cognito_user_pool.this.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 15
  id_token_validity             = 15
  refresh_token_validity        = 1
  read_attributes               = ["email"]
  write_attributes              = ["name"]

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# Delegated user OIDC only. Never grant a machine client-credentials identity
# financial authority; this client's verified tokens are always AI-originated.
resource "aws_cognito_user_pool_client" "mcp" {
  count                                = length(var.mcp_callback_urls) > 0 ? 1 : 0
  name                                 = "${var.name}-mcp"
  user_pool_id                         = aws_cognito_user_pool.this.id
  generate_secret                      = false
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.mcp_callback_urls
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 1
  read_attributes                      = ["email"]
  write_attributes                     = ["name"]

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  count        = length(var.mcp_callback_urls) > 0 ? 1 : 0
  domain       = var.name
  user_pool_id = aws_cognito_user_pool.this.id
}
