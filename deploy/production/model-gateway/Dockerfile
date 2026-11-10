FROM node:22-bookworm-slim
COPY deploy/production/model-gateway/gateway.mjs /gateway.mjs
USER node
EXPOSE 8080
CMD ["node", "/gateway.mjs"]
