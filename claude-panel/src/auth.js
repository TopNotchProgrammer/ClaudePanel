const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PANEL_PASSWORD, PANEL_AUTH_OFF, CLAUDE_DIR, LANG } = require("./config");
const { pick } = require("./ui/i18n");

const t = pick(LANG);
const MAX_AGE_S = 30 * 24 * 3600;
// Bez uwierzytelnienia: healthchecki i publiczny cert CA (sam cert, bez klucza).
const PUBLIC = new Set(["/healthz", "/ca.crt"]);

// "off" (PANEL_AUTH=off) | "missing" (brak PANEL_PASSWORD → panel zablokowany z instrukcją) | "on"
const MODE = PANEL_AUTH_OFF ? "off" : PANEL_PASSWORD ? "on" : "missing";

// Sekret instalacji trzymany obok sesji Claude'a (persystentny bind-mount) — cookie przeżywa restart
// kontenera, a wyciek samego cookie nie pozwala zgadywać hasła offline. Zmiana hasła unieważnia sesje.
function loadSecret() {
  const file = path.join(CLAUDE_DIR, "panel-auth.key");
  try {
    const s = fs.readFileSync(file, "utf8").trim();
    if (s.length >= 32) return s;
  } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  try { fs.writeFileSync(file, s + "\n", { mode: 0o600 }); }
  catch (e) { console.error("[auth] nie mogę zapisać " + file + " (" + e.message + ") — sesje nie przeżyją restartu"); }
  return s;
}
const KEY = MODE === "on" ? crypto.createHmac("sha256", loadSecret()).update(PANEL_PASSWORD).digest() : null;
// Nazwa cookie per instalacja: cookies nie rozróżniają portów, więc dwa projekty na localhost:8080/8081
// z jedną nazwą nadpisywałyby sobie sesje (wylogowanie przy każdym przełączeniu).
const COOKIE = KEY ? "cpa_" + crypto.createHash("sha256").update(KEY).digest("hex").slice(0, 10) : "cpa_session";

// Wylogowane tokeny (sygnatura → exp). Persystowane, żeby wylogowanie przeżyło restart; wygasłe są wycinane.
const REVOKED_FILE = path.join(CLAUDE_DIR, "panel-auth.revoked");
const revoked = new Map();
try {
  for (const [sig, exp] of Object.entries(JSON.parse(fs.readFileSync(REVOKED_FILE, "utf8")))) revoked.set(sig, exp);
} catch {}
function saveRevoked() {
  const now = Date.now() / 1000;
  for (const [sig, exp] of revoked) if (exp < now) revoked.delete(sig);
  try { fs.writeFileSync(REVOKED_FILE, JSON.stringify(Object.fromEntries(revoked)), { mode: 0o600 }); } catch {}
}

function sign(payload) {
  return crypto.createHmac("sha256", KEY).update(payload).digest("base64url");
}
// token = exp.nonce.HMAC(exp.nonce) — nonce, żeby wylogowanie jednej sesji nie unieważniało innych
function makeToken() {
  const payload = (Math.floor(Date.now() / 1000) + MAX_AGE_S) + "." + crypto.randomBytes(9).toString("base64url");
  return payload + "." + sign(payload);
}
function parseToken(tok) {
  const m = /^(\d+)\.([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/.exec(tok || "");
  if (!m || Number(m[1]) < Date.now() / 1000 || revoked.has(m[3])) return null;
  const a = Buffer.from(m[3]), b = Buffer.from(sign(m[1] + "." + m[2]));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? { exp: Number(m[1]), sig: m[3] } : null;
}
// Wszystkie wystąpienia cookie — inna usługa na tym samym hoście może podrzucić cookie o tej nazwie
// z węższym Path, które przeglądarka wyśle jako pierwsze.
function validSession(req) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      const s = parseToken(part.slice(i + 1).trim());
      if (s) return s;
    }
  }
  return null;
}
function isAuthed(req) {
  return MODE === "off" || (MODE === "on" && !!validSession(req));
}
function passwordOk(input) {
  const a = crypto.createHash("sha256").update(String(input)).digest();
  const b = crypto.createHash("sha256").update(PANEL_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function secure(req) {
  return !!req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
}
function setCookie(req, value, maxAge) {
  return COOKIE + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAge + (secure(req) ? "; Secure" : "");
}
// Tylko ścieżki w obrębie panelu i wyłącznie drukowalne ASCII: TAB/CR/LF przeglądarka wycina z URL-a
// (`/\t/evil.com` → `//evil.com` = open redirect), a znaki spoza Latin-1 wywracają writeHead.
function safeNext(n) {
  return typeof n === "string" && /^\/(?![/\\])[\x21-\x7e]*$/.test(n) ? n : "/";
}

// Request zmieniający stan musi przyjść z tego samego originu. SameSite=Lax nie chroni przed stronami
// same-site (inny port tego samego hosta — np. dev-serwer projektu — albo subdomena), a /api/send
// wkleja prompt do Claude'a z --dangerously-skip-permissions.
function sameOrigin(req) {
  // Fetch Metadata liczy przeglądarka względem originu strony — działa też za proxy, które przepisuje Host.
  if (req.headers["sec-fetch-site"] === "same-origin") return true;
  const origin = req.headers.origin;
  if (!origin || origin === "null") return false;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  return host === req.headers.host || (!!req.headers["x-forwarded-host"] && host === req.headers["x-forwarded-host"]);
}

// Brute force: po 5 nieudanych próbach z jednego adresu blokada 30 s, podwajana przy kolejnych (max 15 min);
// licznik wygasa po godzinie bez prób. IPv6 liczone po /64 (atakujący ma ich miliardy). Mapa ograniczona —
// przy przepełnieniu wypadają najstarsze wpisy, nigdy wszystkie naraz (inaczej 10k adresów = reset blokad).
// Za reverse proxy wszyscy mają adres proxy — blokada jest wtedy wspólna (README).
const fails = new Map();
function clientKey(req) {
  const ip = (req.socket.remoteAddress || "?").replace(/^::ffff:/, "");
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;
}
function failState(key) {
  const f = fails.get(key);
  if (f && f.last < Date.now() - 3600e3) { fails.delete(key); return null; }
  return f;
}
function lockedFor(key) {
  const f = failState(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function recordFail(key) {
  const f = failState(key) || { n: 0, until: 0, last: 0 };
  f.n++;
  f.last = Date.now();
  if (f.n >= 5) f.until = Date.now() + Math.min(30000 * 2 ** (f.n - 5), 15 * 60000);
  fails.delete(key);
  fails.set(key, f);
  while (fails.size > 10000) fails.delete(fails.keys().next().value);
  if (f.n <= 5 || f.n % 10 === 0) console.error("[auth] nieudane logowanie z " + key + " (" + f.n + ")");
}

// Otwarte połączenia per sesja (SSE, WebSocket terminala) — wylogowanie je zamyka, inaczej shell
// na drugim urządzeniu żyłby do zamknięcia karty.
const live = new Map();
function track(req, socket) {
  const s = MODE === "on" && validSession(req);
  if (!s) return;
  if (!live.has(s.sig)) live.set(s.sig, new Set());
  live.get(s.sig).add(socket);
  socket.once("close", () => {
    const set = live.get(s.sig);
    if (set && set.delete(socket) && !set.size) live.delete(s.sig);
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function page(title, inner) {
  return `<!doctype html><html lang="${t.locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d1117"><meta name="robots" content="noindex">
<title>${esc(title)} · ${esc(t.appTitle)}</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d1117;color:#e6edf3;
font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:16px;box-sizing:border-box}
.box{width:100%;max-width:440px;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:24px;box-sizing:border-box}
h1{font-size:18px;margin:0 0 16px}
label{display:block;font-size:13px;color:#8b949e;margin-bottom:6px}
input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font-size:16px}
input:focus,button:focus-visible{outline:2px solid #58a6ff;outline-offset:1px;border-color:transparent}
button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:8px;background:#58a6ff;color:#0d1117;font-size:16px;font-weight:600;cursor:pointer}
button:hover{background:#79b8ff}
.err{color:#ff7b72;margin:0 0 12px}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;background:#0d1117;border-radius:6px}
code{padding:1px 5px}
pre{padding:12px;border:1px solid #30363d;overflow-x:auto}
p{color:#c9d1d9}
</style></head><body><div class="box">${inner}</div></body></html>`;
}

function sendPage(res, status, html, extra) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extra });
  res.end(html);
}

function loginPage(next, error) {
  // Hash (#/s/projekt/sesja) nie dociera do serwera — dokleja go skrypt, żeby po logowaniu wrócić w to samo miejsce.
  return page(t.loginTitle, `<h1>${esc(t.loginTitle)}</h1>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<form method="post" action="/login">
<input type="hidden" name="next" value="${esc(next)}">
<input type="text" name="username" value="claude-panel" autocomplete="username" hidden>
<label for="pw">${esc(t.loginPassword)}</label>
<input type="password" id="pw" name="password" autocomplete="current-password" autofocus required>
<button type="submit">${esc(t.loginButton)}</button>
</form>
<script>(function(){var n=document.querySelector('[name=next]');if(location.hash&&n.value.indexOf('#')<0)n.value+=location.hash})()</script>`);
}

function missingPage() {
  return page(t.authMissingTitle, `<h1>${esc(t.authMissingTitle)}</h1>
<p>${t.authMissingBody}</p>
<pre>    environment:
      PANEL_PASSWORD: \${PANEL_PASSWORD}</pre>
<p>${t.authMissingEnv}</p>
<pre>PANEL_PASSWORD='${esc(t.authMissingExample)}'</pre>
<pre>docker compose up -d</pre>
<p>${t.authMissingOff}</p>`);
}

function readForm(req, res, cb) {
  let body = "";
  req.setEncoding("utf8"); // hasło z „ą” nie rozpadnie się na granicy chunków
  req.on("data", (c) => {
    body += c;
    if (body.length > 4096) {
      req.removeAllListeners("data");
      res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" });
      res.end("payload too large");
      req.destroy();
    }
  });
  req.on("end", () => { if (!res.writableEnded) cb(new URLSearchParams(body)); });
}

function handleLogin(req, res, query) {
  if (req.method !== "POST") {
    const next = safeNext(query.get("next"));
    if (isAuthed(req)) {
      res.writeHead(303, { Location: next, "Cache-Control": "no-store" });
      return res.end();
    }
    return sendPage(res, 200, loginPage(next));
  }
  const key = clientKey(req);
  readForm(req, res, (form) => {
    const next = safeNext(form.get("next"));
    const wait = lockedFor(key);
    if (wait) {
      const msg = t.loginLocked.replace("{s}", wait > 90 ? Math.ceil(wait / 60) + " min" : wait + " s");
      return sendPage(res, 429, loginPage(next, msg), { "Retry-After": String(wait) });
    }
    if (passwordOk(form.get("password") || "")) {
      fails.delete(key);
      res.writeHead(303, { Location: next, "Set-Cookie": setCookie(req, makeToken(), MAX_AGE_S), "Cache-Control": "no-store" });
      return res.end();
    }
    recordFail(key);
    setTimeout(() => sendPage(res, 401, loginPage(next, t.loginWrong)), 500);
  });
}

function handleLogout(req, res) {
  const s = validSession(req);
  if (s) {
    revoked.set(s.sig, s.exp);
    saveRevoked();
    for (const sock of live.get(s.sig) || []) sock.destroy();
    live.delete(s.sig);
  }
  res.writeHead(303, { Location: "/login", "Set-Cookie": setCookie(req, "", 0), "Cache-Control": "no-store" });
  res.end();
}

// Wołane na początku każdego requestu HTTP. true = odpowiedź już wysłana (login/logout/blokada),
// false = przepuść do właściwego routingu.
function guard(req, res, pathname, query) {
  // Panel nie może być osadzany w ramce na obcej stronie (clickjacking przycisków).
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (PUBLIC.has(pathname)) return false;
  if (MODE === "missing") {
    if (pathname.startsWith("/api/")) {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      res.end('{"ok":false,"error":"PANEL_PASSWORD not set"}');
    } else {
      sendPage(res, 503, missingPage());
    }
    return true;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end('{"ok":false,"error":"cross-origin request"}');
    return true;
  }
  if (MODE === "off") return false;
  if (pathname === "/login") { handleLogin(req, res, query); return true; }
  if (pathname === "/logout") {
    if (req.method === "POST") handleLogout(req, res);
    else { res.writeHead(303, { Location: "/", "Cache-Control": "no-store" }); res.end(); }
    return true;
  }
  if (isAuthed(req)) return false;
  if (pathname.startsWith("/api/")) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end('{"ok":false,"error":"unauthorized"}');
  } else {
    res.writeHead(302, { Location: "/login?next=" + encodeURIComponent(req.url || "/"), "Cache-Control": "no-store" });
    res.end();
  }
  return true;
}

// WebSocket do /terminal (pełny shell!): wymagane cookie + Origin z tego samego hosta.
function allowUpgrade(req) {
  if (MODE === "missing") return false;
  if (!sameOrigin(req)) return false;
  return isAuthed(req);
}

function logStartup() {
  if (MODE === "missing") console.error("[auth] PANEL_PASSWORD nie jest ustawione — panel zablokowany (strona z instrukcją). Ustaw hasło w compose albo PANEL_AUTH=off.");
  else if (MODE === "off") console.log("[auth] PANEL_AUTH=off — panel bez hasła");
  else {
    console.log("[auth] logowanie hasłem włączone");
    if (PANEL_PASSWORD.length < 12) console.error("[auth] uwaga: PANEL_PASSWORD ma mniej niż 12 znaków — łatwe do zgadnięcia");
  }
}

module.exports = { guard, allowUpgrade, track, logStartup, MODE };
