# aforge-runtime: the isolated Ubuntu box a generated app runs in (backend + frontend + Nginx).
# The app's own .aforge/start.sh copies /workspace to /app, builds and starts everything.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Keep Nginx's enabled default site: start scripts replace sites-available/default.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git rsync nginx \
      python3 python3-pip python3-venv dotnet-sdk-8.0 \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

RUN cp -a /etc/nginx /opt/nginx-template

WORKDIR /app
EXPOSE 80
CMD ["bash", "/workspace/.aforge/start.sh"]
