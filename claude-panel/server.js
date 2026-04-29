#!/usr/bin/env node
const http = require("node:http");
const { PORT, CLAUDE_DIR } = require("./src/config");
require("./src/files");           // side effect: mkdir uploads + wipe on real boot
const { startWatchers } = require("./src/sse");
const handle = require("./src/routes");
const { proxyWs } = require("./src/proxy");

startWatchers();

const server = http.createServer(handle);
server.on("upgrade", (req, socket, head) => {
  if (req.url && (req.url === "/terminal" || req.url.startsWith("/terminal/") || req.url.startsWith("/terminal?"))) {
    proxyWs(req, socket, head);
  } else {
    socket.destroy();
  }
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("[claude-panel] listening on http://0.0.0.0:" + PORT);
  console.log("[claude-panel] reading from " + CLAUDE_DIR);
});
