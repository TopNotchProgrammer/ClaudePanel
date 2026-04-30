FROM node:22-slim

ARG TTYD_VERSION=1.7.7
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tmux ca-certificates curl git docker.io \
 && case "$TARGETARCH" in \
      amd64) TTYD_ARCH=x86_64 ;; \
      arm64) TTYD_ARCH=aarch64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/ttyd \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${TTYD_ARCH}" \
 && chmod +x /usr/local/bin/ttyd \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN mkdir -p /tmp/cpa-tmux /etc/cpa-tmux \
 && chown -R node:node /tmp/cpa-tmux

RUN printf '%s\n' \
      '#!/bin/sh' \
      'exec tmux -S "${TMUX_SOCKET:-/tmp/cpa-tmux/default}" attach-session -t "${TMUX_TARGET:-cpa-tmux}"' \
      > /usr/local/bin/cpa-attach \
 && chmod +x /usr/local/bin/cpa-attach

ENV TERM=xterm-256color \
    COLORTERM=truecolor \
    FORCE_COLOR=3 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

COPY tmux.conf /etc/cpa-tmux/tmux.conf
COPY --chown=node:node . /srv

WORKDIR /srv
USER node
CMD ["sh", "/srv/start.sh"]
