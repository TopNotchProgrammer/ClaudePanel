#!/bin/sh
set -u
cd "$(dirname "$0")"

touch claude.json
mkdir -p claude
docker compose up -d --build
sleep 2
#clear

docker exec -it claude-panel cpa-attach
