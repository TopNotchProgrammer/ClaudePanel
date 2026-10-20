#!/usr/bin/env node
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { PORT, CLAUDE_DIR } = require("./src/config");
require("./src/files");           // side effect: mkdir uploads + wipe on real boot
const { startWatchers } = require("./src/sse");
const handle = require("./src/routes");
const { proxyWs } = require("./src/proxy");
const { loadTls, createPlainHandler, viaProxy } = require("./src/tls");
const auth = require("./src/auth");

startWatchers();
auth.logStartup();

// Siatka bezpieczeństwa: pod `node --watch` crash nie restartuje procesu (czeka na zmianę pliku), więc
// jeden nieprzewidziany wyjątek z requestu kładłby panel do ręcznego restartu kontenera.
process.on("uncaughtException", (e) => console.error("[claude-panel] uncaught:", e));

function onUpgrade(req, socket, head) {
  // WebSocket terminala = pełny shell w kontenerze — bez sesji (albo z obcego Origin) nie przechodzi.
  if (!auth.allowUpgrade(req)) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  if (req.url && (req.url === "/terminal" || req.url.startsWith("/terminal/") || req.url.startsWith("/terminal?"))) {
    auth.track(req, socket); // wylogowanie zamyka shell
    proxyWs(req, socket, head);
  } else {
    socket.destroy();
  }
}

const tls = loadTls();
let server, inner = [];
if (tls) {
  // Jeden port, dwa protokoły: pierwszy bajt 0x16 = TLS ClientHello → https, reszta → plain (redirect na https,
  // chyba że request przyszedł przez reverse proxy — patrz src/tls.js).
  const httpsServer = https.createServer(tls, handle);
  httpsServer.on("upgrade", onUpgrade);
  httpsServer.on("tlsClientError", () => {}); // przeglądarka odrzuca niezaufany cert przy każdym ostrzeżeniu — nie spamuj logów
  const plainServer = http.createServer(createPlainHandler(handle));
  plainServer.on("upgrade", (req, socket, head) => {
    if (viaProxy(req)) return onUpgrade(req, socket, head);
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  inner = [httpsServer, plainServer];
  server = net.createServer({ noDelay: true }, (socket) => {
    socket.on("error", () => {});
    // Przed pierwszym bajtem żaden timeout Node nie działa — socket, który nic nie wyśle, wisiałby wiecznie.
    socket.setTimeout(10000, () => socket.destroy());
    socket.once("data", (buf) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(buf);
      (buf[0] === 0x16 ? httpsServer : plainServer).emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
  });
} else {
  server = http.createServer(handle);
  server.on("upgrade", onUpgrade);
}

server.listen(PORT, "0.0.0.0", () => {
  // http.Server włącza headersTimeout/requestTimeout (ochrona przed slowloris) dopiero na "listening",
  // a wewnętrzne serwery nigdy nie robią listen() — dostają sockety przez emit("connection").
  for (const s of inner) s.emit("listening");
  console.log("[claude-panel] listening on " + (tls ? "https" : "http") + "://0.0.0.0:" + PORT);
  console.log("[claude-panel] reading from " + CLAUDE_DIR);
});
