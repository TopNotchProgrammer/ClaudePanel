#!/bin/sh
set -u
cd "$(dirname "$0")"

touch claude.json
mkdir -p claude
docker compose up -d --build

echo "Waiting for tmux session inside container..."
timeout=120
elapsed=0
while ! docker exec claude-panel tmux -S /tmp/cpa-tmux/default has-session -t cpa-tmux 2>/dev/null; do
  sleep 2
  elapsed=$((elapsed + 2))
  if [ "$elapsed" -ge "$timeout" ]; then
    echo "Timeout waiting for tmux session. Check container logs: docker logs claude-panel"
    exit 1
  fi
done

docker exec -it claude-panel cpa-attach
