terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.50" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  # The backup account has shared keys disabled, so the provider must use Entra ID for data-plane reads.
  storage_use_azuread = true
}

locals {
  name = "reactor-${var.environment}"
  tags = { app = "reactor", environment = var.environment }
  # Ampere sizes (B2ps_v2, D4pls_v5 …) need the arm64 image and do not support Trusted Launch here.
  arm = can(regex("^Standard_[A-Z]+[0-9]+[a-z]*p", var.vm_size))
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.42.0.0/24"]
  tags                = local.tags
}

resource "azurerm_subnet" "main" {
  name                 = "snet-${local.name}"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.42.0.0/26"]
}

# Only SSH from the admin address; users reach the app through the outbound Cloudflare Tunnel.
resource "azurerm_network_security_group" "main" {
  name                = "nsg-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags

  security_rule {
    name                       = "ssh-admin"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "22"
    source_address_prefixes    = var.ssh_allowed_cidrs
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "main" {
  subnet_id                 = azurerm_subnet.main.id
  network_security_group_id = azurerm_network_security_group.main.id
}

# A public IP is the cheapest outbound path (~3.6 USD/month); a NAT gateway would cost ~10x more.
resource "azurerm_public_ip" "main" {
  name                = "pip-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

resource "azurerm_network_interface" "main" {
  name                = "nic-${local.name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.tags

  ip_configuration {
    name                          = "primary"
    subnet_id                     = azurerm_subnet.main.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.main.id
  }
}

resource "azurerm_linux_virtual_machine" "main" {
  name                            = "vm-${local.name}"
  computer_name                   = local.name
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  size                            = var.vm_size
  admin_username                  = var.admin_username
  disable_password_authentication = true
  network_interface_ids           = [azurerm_network_interface.main.id]
  custom_data                     = base64encode(file("${path.module}/cloud-init.yaml"))
  secure_boot_enabled             = !local.arm
  vtpm_enabled                    = !local.arm
  tags                            = local.tags

  admin_ssh_key {
    username   = var.admin_username
    public_key = file(pathexpand(var.ssh_public_key_path))
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = var.os_disk_gb
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = local.arm ? "server-arm64" : "server"
    version   = "latest"
  }

  identity {
    type = "SystemAssigned"
  }

  # Data lives on the OS disk: editing cloud-init or a new image must never recreate the VM.
  lifecycle {
    ignore_changes = [custom_data, source_image_reference]
  }
}

# Shutdown deallocates compute billing; disk, IP and storage keep charging. Start is manual (see outputs).
resource "azurerm_dev_test_global_vm_shutdown_schedule" "main" {
  virtual_machine_id    = azurerm_linux_virtual_machine.main.id
  location              = azurerm_resource_group.main.location
  enabled               = var.shutdown_time != ""
  daily_recurrence_time = var.shutdown_time != "" ? var.shutdown_time : "2000"
  timezone              = var.timezone
  tags                  = local.tags

  notification_settings {
    enabled = false
  }
}

resource "random_string" "storage" {
  length  = 6
  upper   = false
  special = false
}

resource "azurerm_storage_account" "backups" {
  name                            = "streactor${var.environment}${random_string.storage.result}"
  location                        = azurerm_resource_group.main.location
  resource_group_name             = azurerm_resource_group.main.name
  account_kind                    = "StorageV2"
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  # restic authenticates with the VM's managed identity, so no account key exists to leak.
  shared_access_key_enabled = false
  tags                      = local.tags

  blob_properties {
    delete_retention_policy {
      days = 7
    }
    container_delete_retention_policy {
      days = 7
    }
  }
}

resource "azurerm_storage_container" "backups" {
  name                  = "reactor-backups"
  storage_account_id    = azurerm_storage_account.backups.id
  container_access_type = "private"
}

resource "azurerm_role_assignment" "vm_backups" {
  scope                = azurerm_storage_account.backups.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_virtual_machine.main.identity[0].principal_id
}
