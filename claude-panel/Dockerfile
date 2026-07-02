FROM nvidia/cuda:12.0.1-runtime-ubuntu22.04

ARG TTYD_VERSION=1.7.7
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tmux ca-certificates curl git docker.io python3 python3-pip ffmpeg openssl \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && case "$TARGETARCH" in \
      amd64) TTYD_ARCH=x86_64 ;; \
      arm64) TTYD_ARCH=aarch64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/ttyd \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${TTYD_ARCH}" \
 && chmod +x /usr/local/bin/ttyd \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN pip3 install --no-cache-dir \
    faster-whisper fastapi uvicorn python-multipart \
    'transformers<4.50' TTS \
 && pip3 install --no-cache-dir \
    torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121

RUN groupadd -g 1000 node \
 && useradd -u 1000 -g node -m node

RUN mkdir -p /tmp/cpa-tmux /etc/cpa-tmux /opt/models \
 && chown -R node:node /tmp/cpa-tmux /opt/models

RUN printf '%s\n' \
      '#!/bin/sh' \
      'exec tmux -S "${TMUX_SOCKET:-/tmp/cpa-tmux/default}" attach-session -t "${TMUX_TARGET:-cpa-tmux}"' \
      > /usr/local/bin/cpa-attach \
 && chmod +x /usr/local/bin/cpa-attach

ENV TERM=xterm-256color \
    COLORTERM=truecolor \
    FORCE_COLOR=3 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    ASR_URL=http://127.0.0.1:8000 \
    COQUI_TOS_AGREED=1 \
    HF_HOME=/opt/models/whisper

COPY tmux.conf /etc/cpa-tmux/tmux.conf
COPY --chown=node:node . /srv

WORKDIR /srv
USER node
CMD ["sh", "/srv/start.sh"]
