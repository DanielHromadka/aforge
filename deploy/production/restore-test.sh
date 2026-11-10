#!/usr/bin/env bash
set -euo pipefail
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${DOCKER_HOST:?}"
target=$(mktemp -d)
name="reactor-restore-check-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$target"; }
trap cleanup EXIT
restic restore latest --tag reactor --target "$target" --include /srv/reactor/data --include /srv/reactor/backup-stage/keycloak.dump
node /opt/reactor/current/scripts/verify-backup.mjs "$target/srv/reactor/data"
docker run --rm -d --name "$name" --network none -e POSTGRES_USER=keycloak -e POSTGRES_DB=keycloak -e "POSTGRES_PASSWORD=$(openssl rand -hex 24)" postgres:17-bookworm >/dev/null
for _ in {1..60}; do if docker exec "$name" pg_isready -U keycloak -d keycloak >/dev/null 2>&1; then break; fi; sleep 1; done
docker exec -i "$name" pg_restore -U keycloak -d keycloak --exit-on-error < "$target/srv/reactor/backup-stage/keycloak.dump"
docker exec "$name" psql -U keycloak -d keycloak -c 'SELECT COUNT(*) FROM realm;' >/dev/null
logger -t reactor 'Backup restore drill passed: JSON, Git and PostgreSQL'
echo 'Backup restored and verified in an isolated temporary directory and database.'
