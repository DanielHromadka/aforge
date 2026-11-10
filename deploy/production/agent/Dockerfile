FROM node:26-bookworm-slim
ARG CLAUDE_VERSION=2.1.302
ARG CODEX_VERSION=0.163.0
RUN apt-get update && apt-get install -y --no-install-recommends git python3 python3-venv ca-certificates ripgrep \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @anthropic-ai/claude-code@${CLAUDE_VERSION} @openai/codex@${CODEX_VERSION} \
 && npm cache clean --force \
 && usermod -l agent -d /home/agent node && mkdir -p /workspace /home/agent && chown 1000:1000 /workspace /home/agent
COPY deploy/production/agent/entrypoint.sh /usr/local/bin/reactor-agent
USER 1000:1000
ENV HOME=/home/agent
WORKDIR /workspace
ENTRYPOINT ["reactor-agent"]
