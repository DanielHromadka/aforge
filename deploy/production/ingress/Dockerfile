FROM node:26-bookworm-slim
COPY deploy/production/ingress/proxy.mjs /proxy.mjs
USER node
EXPOSE 8080
CMD ["node", "/proxy.mjs"]
