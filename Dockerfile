FROM node:22-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    docker.io \
    tmux \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN mkdir -p /tmp/cpa-tmux && chown node:node /tmp/cpa-tmux

WORKDIR /app

USER node

CMD ["/bin/bash"]