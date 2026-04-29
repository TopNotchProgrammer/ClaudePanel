FROM node:22-slim
ARG TTYD_VERSION=1.7.7
RUN apt-get update \
 && apt-get install -y --no-install-recommends tmux ca-certificates curl \
 && curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64" \
 && chmod +x /usr/local/bin/ttyd \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
CMD ["sh", "/srv/start.sh"]
