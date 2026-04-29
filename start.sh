#!/bin/sh
set -u
cd "$(dirname "$0")"

touch claude.json
docker compose up -d
sleep 2
clear

SOCK=/tmp/cpa-tmux/default
CONF=/app/claude-panel/tmux.conf

docker exec -u root cpa-claude-code sh -c "rm -fr $SOCK && mkdir -p $(dirname $SOCK) && chown node:node $(dirname $SOCK)"

docker exec \
  -e COLORTERM=truecolor \
  -e FORCE_COLOR=3 \
  -e LANG=C.UTF-8 -e LC_ALL=C.UTF-8 \
  cpa-claude-code sh -c "
  if tmux -S $SOCK has-session -t cpa-tmux 2>/dev/null; then
    tmux -S $SOCK source-file $CONF
    tmux -S $SOCK setenv -g COLORTERM truecolor
    tmux -S $SOCK setenv -g FORCE_COLOR 3
  else
    tmux -u -f $CONF -S $SOCK new-session -d -s cpa-tmux 'claude --dangerously-skip-permissions'
  fi
"

docker exec -it \
  -e TERM="${TERM:-xterm-256color}" \
  -e COLORTERM=truecolor \
  -e LANG=C.UTF-8 -e LC_ALL=C.UTF-8 \
  cpa-claude-code tmux -S $SOCK attach-session -t cpa-tmux
