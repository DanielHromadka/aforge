# aForge relay as a container (Azure Container Apps, App Service, any VPS). Build from the repo root:
#   docker build -f apps/relay/Dockerfile -t aforge-relay .
# Put TLS in front (Container Apps ingress does it) so workers connect with wss://.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/protocol packages/protocol
COPY apps/relay apps/relay
RUN npm ci --workspace @aforge/relay --include-workspace-root=false --ignore-scripts \
 && npm cache clean --force
ENV PORT=8787 NODE_ENV=production
EXPOSE 8787
USER node
CMD ["npx", "tsx", "apps/relay/src/index.ts"]
