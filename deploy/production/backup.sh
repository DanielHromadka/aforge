#!/usr/bin/env bash
set -euo pipefail
exec 9>/run/reactor-backup.lock
flock -n 9 || exit 0
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${DOCKER_HOST:?}" "${REACTOR_CONFIG_DIR:?}"
compose=(docker compose --env-file /etc/reactor/production.env -f /opt/reactor/current/deploy/production/compose.yaml)
was_running=0
systemctl is-active --quiet reactor && was_running=1
restart() { "${compose[@]}" start keycloak >/dev/null; if (( was_running )); then systemctl start reactor; fi; }
trap restart EXIT
systemctl stop reactor
# No generated process may still write into a workspace while the store is backed up.
mapfile -t jobs < <(docker ps -q --filter label=aforge.managed=true)
if (( ${#jobs[@]} )); then docker rm -f "${jobs[@]}" >/dev/null; fi
"${compose[@]}" stop keycloak >/dev/null
install -d -m 700 /srv/reactor/backup-stage
"${compose[@]}" exec -T postgres pg_dump -U keycloak -d keycloak -Fc > /srv/reactor/backup-stage/keycloak.dump
restic backup /srv/reactor/data /srv/reactor/backup-stage/keycloak.dump /etc/reactor --tag reactor --exclude '**/.server.lock'
restic check
restic forget --tag reactor --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
install -m 600 /dev/null /srv/reactor/backup-success
