#!/bin/sh
set -eu

export LANG=C.UTF-8
export LC_ALL=C.UTF-8

: "${TMUX_SOCKET:=/host-tmux/default}"
: "${TMUX_TARGET:=cpa-tmux}"
: "${TTYD_PORT:=7681}"

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
