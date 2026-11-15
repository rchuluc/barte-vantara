variable "name" { type = string }

variable "mcp_callback_urls" {
  type    = list(string)
  default = []
  validation {
    condition     = alltrue([for url in var.mcp_callback_urls : startswith(url, "https://")])
    error_message = "MCP callbacks must use HTTPS."
  }
}
