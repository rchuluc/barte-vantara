variable "name" { type = string }

variable "mcp_callback_urls" {
  type    = list(string)
  default = []
  validation {
    condition = alltrue([for url in var.mcp_callback_urls :
      (startswith(url, "https://") && !strcontains(url, "#")) ||
      can(regex("^http://(localhost|127\\.0\\.0\\.1)(:[0-9]{1,5})?/[^#]*$", url))
    ])
    error_message = "MCP callbacks must use HTTPS or an exact localhost/127.0.0.1 HTTP loopback callback, without fragments."
  }
}
