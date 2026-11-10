output "public_ip" {
  value = azurerm_public_ip.main.ip_address
}

output "ssh" {
  value = "ssh ${var.admin_username}@${azurerm_public_ip.main.ip_address}"
}

output "backup_storage_account" {
  value = azurerm_storage_account.backups.name
}

output "start" {
  value = "az vm start -g ${azurerm_resource_group.main.name} -n ${azurerm_linux_virtual_machine.main.name}"
}

output "stop" {
  value = "az vm deallocate -g ${azurerm_resource_group.main.name} -n ${azurerm_linux_virtual_machine.main.name}"
}
