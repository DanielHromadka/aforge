FROM mcr.microsoft.com/playwright:v1.65.0-noble
COPY deploy/production/agent/entrypoint.sh /usr/local/bin/reactor-agent
RUN mkdir -p /workspace /home/agent
ENV HOME=/home/agent
WORKDIR /workspace
ENTRYPOINT ["reactor-agent"]
