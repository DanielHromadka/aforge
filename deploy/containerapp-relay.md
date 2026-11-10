# Relay na Azure Container Apps

```bash
az acr build -r <registry> -t aforge-relay:1 -f apps/relay/Dockerfile .
az containerapp create -g <rg> -n aforge-relay --environment <env> \
  --image <registry>.azurecr.io/aforge-relay:1 --target-port 8787 --ingress external \
  --min-replicas 1 --max-replicas 1 --transport http
```

Relay drží místnosti v paměti, proto **právě jedna replika** (víc replik by potřebovalo sticky routing podle
místnosti). Ingress Container Apps zajistí TLS, workery i Reactor pak používají `wss://aforge-relay.<env>.azurecontainerapps.io`.
Alternativa bez serveru: Cloudflare Worker + Durable Object podle `afinder/mobile/relay` (stejný protokol rámců).
