variable "subscription_id" {
  type        = string
  description = "Azure subscription (az account show --query id -o tsv)."
}

variable "environment" {
  type    = string
  default = "dev"
  validation {
    condition     = can(regex("^[a-z0-9]{2,8}$", var.environment))
    error_message = "2–8 lowercase letters or digits (used in the storage account name)."
  }
}

variable "location" {
  type        = string
  default     = "swedencentral"
  description = "Sweden Central is among the cheapest EU regions for B-series v2."
}

variable "vm_size" {
  type        = string
  default     = "Standard_B2as_v2"
  description = "2 vCPU / 8 GB x86. Standard_B2ps_v2 (ARM) is ~10 % cheaper, Standard_B4as_v2 for parallel agents."
}

variable "os_disk_gb" {
  type    = number
  default = 64
}

variable "admin_username" {
  type    = string
  default = "azureuser"
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}

variable "ssh_allowed_cidrs" {
  type        = list(string)
  description = "Admin addresses allowed to SSH, e.g. [\"203.0.113.7/32\"] (curl -s ifconfig.me)."
  validation {
    condition     = length(var.ssh_allowed_cidrs) > 0 && alltrue([for c in var.ssh_allowed_cidrs : can(cidrhost(c, 0)) && c != "0.0.0.0/0"])
    error_message = "Give at least one CIDR; 0.0.0.0/0 is not allowed."
  }
}

variable "shutdown_time" {
  type        = string
  default     = "2000"
  description = "Daily auto-shutdown HHmm; empty string disables it."
  validation {
    condition     = var.shutdown_time == "" || can(regex("^([01][0-9]|2[0-3])[0-5][0-9]$", var.shutdown_time))
    error_message = "Use HHmm, e.g. 2000."
  }
}

variable "timezone" {
  type    = string
  default = "Central Europe Standard Time"
}
