#!/usr/bin/env node
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const { PORT, CLAUDE_DIR } = require("./src/config");
require("./src/files");           // side effect: mkdir uploads + wipe on real boot
const { startWatchers } = require("./src/sse");
const handle = require("./src/routes");
const { proxyWs } = require("./src/proxy");

startWatchers();

const TLS_KEY = process.env.TLS_KEY || "/tmp/cpa-tls/key.pem";
const TLS_CERT = process.env.TLS_CERT || "/tmp/cpa-tls/cert.pem";
let server;
let proto;

if (fs.existsSync(TLS_KEY) && fs.existsSync(TLS_CERT)) {
  server = https.createServer({ key: fs.readFileSync(TLS_KEY), cert: fs.readFileSync(TLS_CERT) }, handle);
  proto = "https";
} else {
  server = http.createServer(handle);
  proto = "http";
}

server.on("upgrade", (req, socket, head) => {
  if (req.url && (req.url === "/terminal" || req.url.startsWith("/terminal/") || req.url.startsWith("/terminal?"))) {
    proxyWs(req, socket, head);
  } else {
    socket.destroy();
  }
});
server.listen(PORT, "0.0.0.0", () => {
  console.log("[claude-panel] listening on " + proto + "://0.0.0.0:" + PORT);
  console.log("[claude-panel] reading from " + CLAUDE_DIR);
});

