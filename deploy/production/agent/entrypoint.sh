#!/bin/sh
set -eu
mkdir -p "$HOME/.codex" "$HOME/.claude"
if [ -d /source ]; then
  tar -C /source --exclude=.git --exclude=node_modules --exclude=bin --exclude=obj --exclude=dist -cf - . | tar -C /workspace -xf -
fi
if [ "$1" = codex ] && [ -n "${OPENAI_API_KEY:-}" ]; then
  printf '%s' "$OPENAI_API_KEY" | codex login --with-api-key >/dev/null 2>&1
fi
set +e
"$@"
code=$?
set -e
if [ -d /source ]; then
  # Export regular project files; build output and Git metadata stay out of the host.
  tar -C /workspace --exclude=.git --exclude=node_modules --exclude=bin --exclude=obj --exclude=dist -cf /tmp/result.tar .
  printf '__REACTOR_RESULT_READY:%s\n' "$code"
  # tmpfs disappears on stop: controller exports and validates files before removing this container.
  while :; do sleep 10; done
fi
exit "$code"
