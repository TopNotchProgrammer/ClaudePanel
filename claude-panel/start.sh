#!/bin/sh
set -eu

export LANG=C.UTF-8
export LC_ALL=C.UTF-8

: "${TMUX_SOCKET:=/tmp/cpa-tmux/default}"
: "${TMUX_TARGET:=cpa-tmux}"
: "${TTYD_PORT:=7681}"
: "${TMUX_CONF:=/etc/cpa-tmux/tmux.conf}"
: "${CLAUDE_ARGS:=--dangerously-skip-permissions}"
: "${MODELS_DIR:=/opt/models}"
: "${WHISPER_MODEL:=large-v3}"

export HF_HOME="$MODELS_DIR/whisper"
export TTS_REF_WAV="${TTS_REF_WAV:-/srv/asr/ref_voice.wav}"

# --- First-boot model download ---
mkdir -p "$MODELS_DIR/whisper" "$MODELS_DIR/tts" /home/node/.local/share
ln -sfn "$MODELS_DIR/tts" /home/node/.local/share/tts 2>/dev/null || true

# Whisper
if ! python3 -c "from faster_whisper import WhisperModel; WhisperModel('$WHISPER_MODEL', device='cpu', compute_type='int8')" 2>/dev/null; then
  echo "[setup] downloading Whisper model: $WHISPER_MODEL ..."
  python3 -c "from faster_whisper import WhisperModel; WhisperModel('$WHISPER_MODEL', device='cpu', compute_type='int8')"
  echo "[setup] Whisper model ready"
fi

# XTTS model is auto-downloaded by TTS library on first use, cached in $MODELS_DIR/tts
echo "[setup] models ready"

# --- Services ---
mkdir -p "$(dirname "$TMUX_SOCKET")"

if tmux -S "$TMUX_SOCKET" has-session -t "$TMUX_TARGET" 2>/dev/null; then
  tmux -S "$TMUX_SOCKET" source-file "$TMUX_CONF" >/dev/null 2>&1 || true
else
  tmux -u -f "$TMUX_CONF" -S "$TMUX_SOCKET" \
    new-session -d -s "$TMUX_TARGET" "claude $CLAUDE_ARGS"
fi

ttyd \
  -p "$TTYD_PORT" \
  -i 127.0.0.1 \
  -W \
  -b /terminal \
  -t 'titleFixed=Claude tmux' \
  -t 'fontSize=14' \
  -t 'rendererType=dom' \
  -t 'theme={"background":"#0d1117","foreground":"#e6edf3","cursor":"#e6edf3","selectionBackground":"#264f78","black":"#0d1117","red":"#ff7b72","green":"#7ee787","yellow":"#ffa657","blue":"#79c0ff","magenta":"#d2a8ff","cyan":"#a5d6ff","white":"#e6edf3","brightBlack":"#6e7681","brightRed":"#ffa198","brightGreen":"#56d364","brightYellow":"#e3b341","brightBlue":"#a5d6ff","brightMagenta":"#d2a8ff","brightCyan":"#b3f0ff","brightWhite":"#ffffff"}' \
  tmux -u -S "$TMUX_SOCKET" attach-session -t "$TMUX_TARGET" &

python3 -m uvicorn server:app --host 127.0.0.1 --port "${ASR_PORT:-8000}" --app-dir /srv/asr &

TLS_DIR="${TLS_DIR:-/tmp/cpa-tls}"
mkdir -p "$TLS_DIR"
if [ ! -f "$TLS_DIR/cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem" \
    -days 3650 -nodes \
    -subj "/CN=claude-panel" \
    -addext "subjectAltName=DNS:localhost,DNS:claude-panel,IP:127.0.0.1" \
    2>/dev/null
  echo "[claude-panel] generated self-signed TLS cert in $TLS_DIR"
fi
export TLS_KEY="$TLS_DIR/key.pem"
export TLS_CERT="$TLS_DIR/cert.pem"

exec node --watch server.js
