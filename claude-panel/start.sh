#!/bin/sh
set -eu

export LANG=C.UTF-8
export LC_ALL=C.UTF-8

: "${TMUX_SOCKET:=/tmp/cpa-tmux/default}"
: "${TMUX_TARGET:=cpa-tmux}"
: "${TTYD_PORT:=7681}"
: "${TMUX_CONF:=/etc/cpa-tmux/tmux.conf}"
: "${CLAUDE_ARGS:=--dangerously-skip-permissions}"
: "${TLS:=auto}"

mkdir -p "$(dirname "$TMUX_SOCKET")"

# HTTPS: TLS=auto (domyślnie) → cert per projekt w ${TLS_DIR:-$CLAUDE_DIR/panel-tls} (tls-init.sh),
# chyba że podano własne TLS_CERT + TLS_KEY. TLS=off|false|0|no → goły HTTP.
TLS_MODE=$(printf '%s' "$TLS" | tr 'A-Z' 'a-z')
case "$TLS_MODE" in
  auto|on|true|1|yes|"") ;;
  off|false|0|no) ;;
  *) echo "[tls] nieznana wartość TLS='$TLS' — traktuję jak auto (dozwolone: auto, off)" >&2 ;;
esac
case "$TLS_MODE" in
  off|false|0|no)
    unset TLS_CERT TLS_KEY TLS_CA ;;
  *)
    if [ -n "${TLS_CERT:-}" ] || [ -n "${TLS_KEY:-}" ]; then
      if [ -z "${TLS_CERT:-}" ] || [ -z "${TLS_KEY:-}" ]; then
        echo "[tls] ustawiono tylko jedno z TLS_CERT/TLS_KEY — potrzebne oba; panel wstaje na HTTP" >&2
        unset TLS_CERT TLS_KEY
      fi
    else
      : "${TLS_DIR:=${CLAUDE_DIR:-/home/node/.claude}/panel-tls}"
      export TLS_DIR
      if sh /srv/tls-init.sh; then
        export TLS_CERT="$TLS_DIR/cert.pem" TLS_KEY="$TLS_DIR/key.pem" TLS_CA="$TLS_DIR/ca.crt"
      else
        echo "[tls] generacja certyfikatu nie powiodła się — panel wstaje na HTTP" >&2
      fi
    fi ;;
esac

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

exec node --watch server.js
