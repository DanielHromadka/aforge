#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root on the production server'; exit 1; }
archive=$(realpath "${1:?Supply a release .tar.gz}")
[[ -f "$archive.sha256" ]] || { echo 'Missing SHA-256 manifest'; exit 1; }
(cd "$(dirname "$archive")" && sha256sum --check "$(basename "$archive").sha256")
# Configuration is controlled by the server administrator, never shipped in a release.
set -a
source /etc/reactor/production.env
set +a
version=$(basename "$archive" .tar.gz)
[[ $version =~ ^reactor-[0-9]+$ ]] || { echo 'Invalid release name'; exit 1; }
release="/opt/reactor/releases/$version"
[[ ! -e "$release" ]] || { echo 'Release already installed'; exit 1; }
install -d -o reactor -g reactor "$release" /srv/reactor/data /srv/reactor/docker-config
if tar -tzf "$archive" | grep -E '(^/|(^|/)\.\.(/|$))'; then echo 'Unsafe release paths'; exit 1; fi
tar -xzf "$archive" --no-same-owner -C "$release"
chown -R reactor:reactor "$release"
(cd "$release" && runuser -u reactor -- npm ci --include=dev --ignore-scripts)
# Docker must be rootless; the application user cannot control the root daemon.
docker info --format '{{json .SecurityOptions}}' | grep -q rootless || { echo 'Rootless Docker required'; exit 1; }
docker build -t "reactor-agent:$version" -f "$release/deploy/production/agent/Dockerfile" "$release"
docker build -t reactor-model-gateway:latest -f "$release/deploy/production/model-gateway/Dockerfile" "$release"
docker build -t reactor-ingress:latest -f "$release/deploy/production/ingress/Dockerfile" "$release"
docker build -t reactor-playwright:latest -f "$release/deploy/production/playwright/Dockerfile" "$release"
docker build -t reactor-egress:latest -f "$release/deploy/production/egress/Dockerfile" "$release"
docker build -t reactor-relay:latest -f "$release/apps/relay/Dockerfile" "$release"
docker build -t aforge-runtime:latest "$release/runtime"
old=$(readlink -f /opt/reactor/current || true)
if [[ -n "$old" && -d "$old" ]]; then systemctl start reactor-backup.service; fi
install -m 644 "$release"/deploy/production/reactor*.service "$release"/deploy/production/reactor*.timer /etc/systemd/system/
for item in reactor.service reactor-proxy.service; do
  grep -q 'EnvironmentFile=-/etc/reactor/runtime.env' "/etc/systemd/system/$item" || sed -i '/EnvironmentFile=\/etc\/reactor\/production.env/a EnvironmentFile=-/etc/reactor/runtime.env' "/etc/systemd/system/$item"
done
rollback_on_error() {
  local status=$?
  trap - ERR
  systemctl stop reactor.service 2>/dev/null || true
  if [[ -n "$old" && -d "$old" ]]; then
    ln -sfn "$old" /opt/reactor/current.rollback
    mv -Tf /opt/reactor/current.rollback /opt/reactor/current
    printf 'AFORGE_AGENT_IMAGE=reactor-agent:%s\n' "$(basename "$old")" > /etc/reactor/runtime.env
    systemctl restart reactor reactor-proxy || true
  fi
  echo 'Activation failed; previous application code restored when available.' >&2
  exit "$status"
}
trap rollback_on_error ERR
printf 'AFORGE_AGENT_IMAGE=reactor-agent:%s\n' "$version" > /etc/reactor/runtime.env
systemctl stop reactor.service 2>/dev/null || true
ln -s "$release" /opt/reactor/current.next
mv -Tf /opt/reactor/current.next /opt/reactor/current
install -d -m 755 "$REACTOR_CONFIG_DIR"
install -m 644 /etc/reactor/realm.json "$REACTOR_CONFIG_DIR/realm.json"
docker compose --env-file /etc/reactor/production.env -f "$release/deploy/production/compose.yaml" up -d
systemctl daemon-reload
systemctl enable reactor reactor-proxy reactor-monitor.timer reactor-backup.timer >/dev/null
systemctl restart reactor reactor-proxy
ok=0
for _ in {1..60}; do if curl -fsS http://127.0.0.1:4310/health/ready >/dev/null; then ok=1; break; fi; sleep 1; done
if (( ok )); then
  for _ in {1..90}; do if curl -fsS "${KEYCLOAK_INTERNAL_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" >/dev/null; then break; fi; sleep 1; done
  if ! (cd "$release" && node --import tsx scripts/production.mjs check --env /etc/reactor/production.env --image "reactor-agent:$version"); then ok=0; fi
fi
if (( ! ok )); then
  systemctl stop reactor
  if [[ -n "$old" && -d "$old" ]]; then
    ln -s "$old" /opt/reactor/current.rollback; mv -Tf /opt/reactor/current.rollback /opt/reactor/current
    printf 'AFORGE_AGENT_IMAGE=reactor-agent:%s\n' "$(basename "$old")" > /etc/reactor/runtime.env
    systemctl restart reactor reactor-proxy
  fi
  echo 'Deployment failed readiness; previous code restored if available. Inspect journalctl -u reactor.'
  exit 1
fi
trap - ERR
systemctl start reactor-monitor.timer reactor-backup.timer
printf 'Deployed %s. Run production:check, backup + restore drill, and browser acceptance before opening invitations.\n' "$version"
