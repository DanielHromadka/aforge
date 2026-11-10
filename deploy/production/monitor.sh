#!/usr/bin/env bash
set -euo pipefail
failed=0
curl --fail --silent --max-time 10 http://127.0.0.1:4310/health/ready >/dev/null || failed=1
docker info >/dev/null 2>&1 || failed=1
[[ $(docker inspect -f '{{.State.Running}}' "${AFORGE_EGRESS_PROXY}" 2>/dev/null) == true ]] || failed=1
curl --fail --silent --max-time 10 "${KEYCLOAK_INTERNAL_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration" >/dev/null || failed=1
if [[ ! -f /srv/reactor/backup-success ]] || [[ $(find /srv/reactor/backup-success -mmin +1560 -print) ]]; then failed=1; fi
if (( failed )); then
  logger -p daemon.err -t reactor 'Readiness/dependency failure or backup older than 26 hours'
  if [[ -n ${REACTOR_ALERT_WEBHOOK:-} ]]; then
    curl --fail --silent --max-time 10 -H 'Content-Type: application/json' --data '{"text":"Reactor: readiness/dependency failure or backup older than 26 hours"}' "$REACTOR_ALERT_WEBHOOK" >/dev/null
  fi
  exit 1
fi
