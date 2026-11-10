# Reactor dev na Azure (Terraform)

Nejlevnější varianta: jedna Linux VM s auto-shutdownem, bez veřejných aplikačních portů (přístup přes Cloudflare Tunnel), zálohy resticem do privátního Blob kontejneru přes managed identity VM. Média zůstávají v R2 (aplikace používá S3 API). Aplikace se nasazuje stejně jako produkce podle `deploy/production/INSTALL.md`.

## Cena (Sweden Central, pay-as-you-go, ověřeno 2026-10-22)

| Položka | USD/měsíc |
|---|---|
| VM `Standard_B2as_v2` (2 vCPU, 8 GB), 0,0778 $/h, jen když běží | ~17 při 220 h, 57 při 24/7 |
| Standard SSD 64 GB (E6) | 4,80 |
| Statická veřejná IP | 3,65 (platí se i při vypnuté VM) |
| Blob zálohy | < 0,50 |
| **Celkem** | **~26 s auto-shutdownem**, ~66 při 24/7 |

Levnější je `Standard_B2ps_v2` (ARM, 0,0688 $/h). Pro dva agenty a preview zároveň `Standard_B4as_v2` (16 GB, 0,156 $/h). Aktuální ceny: https://prices.azure.com/api/retail/prices

Auto-shutdown VM jen dealokuje (výpočet se přestane účtovat), start je ruční: `terraform output -raw start | sh`.

## 1. Infrastruktura

```bash
cd deploy/azure
az login
cp terraform.tfvars.example terraform.tfvars   # subscription_id, vlastní IP pro SSH
terraform init
terraform apply
```

Účet spouštějící Terraform potřebuje roli Owner nebo User Access Administrator, protože přiřazuje VM roli `Storage Blob Data Contributor` k zálohám. State zůstává lokálně (`*.tfstate`, mimo git).

Cloud-init nainstaluje Node 22, rootless Docker (uživatel `reactor`, UID 1001, delegace cgroups v2), Caddy, cloudflared a restic a připraví `/etc/reactor`, `/opt/reactor`, `/srv/reactor`. Hotovo je, když existuje `/var/lib/reactor-host-ready`:

```bash
$(terraform output -raw ssh) 'cloud-init status --wait; sudo -iu reactor docker info --format "{{.CgroupVersion}} {{.SecurityOptions}}"'
```

## 2. Konfigurace a nasazení

Lokálně (účet je 8 GB, proto jeden souběžný běh):

```bash
npm run production:config -- --app dev.example.com --auth auth-dev.example.com --relay relay-dev.example.com \
  --preview example-preview.net --uid 1001 --backup-azure "$(terraform -chdir=deploy/azure output -raw backup_storage_account)" \
  --out ~/reactor-dev-config
```

V `production.env` nastavit `AFORGE_MAX_JOBS=1`, doplnit R2 média, API klíč a tunnel token, pak zkopírovat do `/etc/reactor` (root, 700/600) a nasadit release:

```bash
npm run release
ip=$(terraform -chdir=deploy/azure output -raw public_ip)
scp -r ~/reactor-dev-config azureuser@$ip:reactor-config
ssh azureuser@$ip 'sudo install -m 600 -o root reactor-config/* /etc/reactor/ && rm -rf reactor-config && mkdir -p reactor-releases'
scp .releases/reactor-*.tar.gz* deploy/production/deploy.sh azureuser@$ip:reactor-releases/
ssh azureuser@$ip 'sudo bash reactor-releases/deploy.sh reactor-releases/reactor-<verze>.tar.gz'
```

Dál pokračovat od `restic init` v INSTALL.md §3 (Cloudflare Tunnel §4, první správce v Keycloaku). Workflow `Deploy production` z GitHubu se na tuto VM nedostane, SSH je povolené jen z `ssh_allowed_cidrs`; dev se nasazuje lokálně.

## Provoz

- Záloha v 03:15 má `Persistent=true`: když byla VM v noci vypnutá, proběhne hned po startu a na pár minut zastaví aplikaci.
- Data jsou na OS disku. Terraform ignoruje změny cloud-initu i image, aby VM nikdy nepřestavěl; `terraform destroy` smaže vše včetně záloh.
- Stará IP pro SSH: upravit `ssh_allowed_cidrs` a `terraform apply`.
