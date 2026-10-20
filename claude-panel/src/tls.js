const fs = require("node:fs");
const tls = require("node:tls");
const { TLS_CERT, TLS_KEY, TLS_CA, PORT } = require("./config");

// Tylko ECDHE + AEAD dla TLS 1.2 (TLS 1.3 ma własne, zawsze nowoczesne suity).
const CIPHERS = [
  "TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305", "ECDHE-RSA-CHACHA20-POLY1305",
].join(":");

// Opcje dla https.createServer z plików wskazanych przez start.sh (tls-init.sh) albo przez operatora;
// null → panel wstaje na HTTP. Para jest walidowana tutaj, żeby zły PEM / niepasujący klucz
// nie wywracał procesu w https.createServer (pod `node --watch` panel by po prostu leżał).
function loadTls() {
  if (!TLS_CERT || !TLS_KEY) return null;
  try {
    const opts = {
      cert: fs.readFileSync(TLS_CERT),
      key: fs.readFileSync(TLS_KEY),
      minVersion: "TLSv1.2",
      ciphers: CIPHERS,
    };
    tls.createSecureContext(opts);
    return opts;
  } catch (e) {
    console.error("[claude-panel] nie mogę użyć certyfikatu TLS (" + e.message + ") — wstaję na HTTP");
    return null;
  }
}

// GET /ca.crt (tylko po HTTPS) — CA projektu do opcjonalnej instalacji (np. iOS, gdzie bez niej nie działa
// WebSocket terminala). Serwujemy wyłącznie bloki CERTIFICATE — nawet jeśli TLS_CA wskazuje na combined PEM
// z kluczem, klucz nie wycieknie.
function serveCa(res) {
  let pem = "";
  try { pem = TLS_CA ? fs.readFileSync(TLS_CA, "utf8") : ""; } catch {}
  const certs = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!certs) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("no local CA (TLS disabled or custom certificate)");
  }
  const body = Buffer.from(certs.join("\n") + "\n");
  res.writeHead(200, {
    "Content-Type": "application/x-x509-ca-cert",
    "Content-Disposition": 'attachment; filename="claude-panel-ca.crt"',
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// Request przyszedł przez reverse proxy / tunel (Traefik, nginx, Cloudflare Tunnel…), który sam terminuje TLS
// albo świadomie gada z panelem po HTTP — redirect na https zrobiłby pętlę albo wysłał przeglądarkę
// na wewnętrzny adres upstreamu. Taki request obsługujemy normalnie.
function viaProxy(req) {
  const h = req.headers;
  return !!(h["x-forwarded-proto"] || h["x-forwarded-for"] || h["x-forwarded-host"] || h["forwarded"]);
}

const HOST_RE = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

// Goły HTTP na porcie TLS. Przez proxy → normalny panel. /healthz → 200 (healthchecki). /api/stream → jeden
// `hello` z innym startupem, żeby karta otwarta jeszcze po HTTP sama się przeładowała (EventSource nie przejdzie
// cross-origin redirectu i umarłby po cichu). Reszta → 307 (nie 308: przeglądarki cache'ują 308 na stałe,
// a po `TLS=off` wisiałyby na martwym https).
function createPlainHandler(handle) {
  return function plainHttpHandler(req, res) {
    if (viaProxy(req)) return handle(req, res);
    const url = req.url && req.url.startsWith("/") ? req.url : "/";
    const pathname = url.split("?")[0];
    if (pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end('{"ok":true}');
    }
    if (pathname === "/api/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      return res.end('data: {"type":"hello","startup":"tls-redirect"}\n\n');
    }
    const host = HOST_RE.test(req.headers.host || "") ? req.headers.host : "localhost:" + PORT;
    res.writeHead(307, { Location: "https://" + host + url, "Cache-Control": "no-store" });
    res.end();
  };
}

module.exports = { loadTls, serveCa, createPlainHandler, viaProxy };
