const url = require("node:url");
const { MAX_UPLOAD_BYTES, STARTUP_ID } = require("./config");
const { saveFile } = require("./files");
const {
  listSessions,
  summarizeSession,
  parseSession,
  detectStatus,
  readHistory,
} = require("./sessions");
const { sseClients, sseBroadcast } = require("./sse");
const { sendText, capturePane, sendInterrupt } = require("./tmux");
const queueMod = require("./queue");
queueMod.setBroadcaster(sseBroadcast);
queueMod.startPeriodic();
const { proxyHttp } = require("./proxy");
const { fetchUsage } = require("./usage");
const INDEX_HTML = require("./ui");

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(s),
    "Cache-Control": "no-store",
  });
  res.end(s);
}

function html(res, body) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function handle(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || "/";
  try {
    if (pathname === "/" || pathname === "/index.html") {
      return html(res, INDEX_HTML);
    }
    if (pathname === "/terminal" || pathname.startsWith("/terminal/")) {
      return proxyHttp(req, res);
    }
    if (pathname === "/api/sessions") {
      const list = listSessions().map(s => {
        try { return summarizeSession(s.id, s.project); } catch { return null; }
      }).filter(Boolean);
      return json(res, 200, list);
    }
    if (pathname === "/api/session") {
      const project = String(parsed.query.project || "");
      const id = String(parsed.query.id || "");
      if (!project || !id) return json(res, 400, { error: "missing project/id" });
      const safeId = /^[A-Za-z0-9._-]+$/.test(id);
      const safeProj = /^[A-Za-z0-9._-]+$/.test(project);
      if (!safeId || !safeProj) return json(res, 400, { error: "bad id" });
      const meta = summarizeSession(id, project);
      const events = parseSession(id, project);
      return json(res, 200, { meta, events });
    }
    if (pathname === "/api/latest") {
      const before = parsed.query.before != null && parsed.query.before !== "" ? Number(parsed.query.before) : null;
      const after = parsed.query.after != null && parsed.query.after !== "" ? Number(parsed.query.after) : null;
      const limit = Math.min(Number(parsed.query.limit) || 50, 500);
      const sessions = listSessions();
      if (!sessions.length) return json(res, 200, { empty: true });
      const newest = sessions[0];
      const events = parseSession(newest.id, newest.project);
      for (let i = 0; i < events.length; i++) events[i]._i = i;
      let slice;
      if (after != null) {
        slice = events.filter(e => e._i > after);
      } else if (before != null) {
        slice = events.filter(e => e._i < before).slice(-limit);
      } else {
        slice = events.slice(-limit);
      }
      const meta = (before == null && after == null) ? summarizeSession(newest.id, newest.project) : null;
      let status = detectStatus(newest.id, newest.project);
      // After Esc, JSONL won't get an assistant turn, so detectStatus would
      // keep saying "thinking" until the cap. Honor the interrupt grace so
      // a refreshed panel shows idle right away.
      if (status === "thinking" && queueMod.wasRecentlyInterrupted()) status = "idle";
      return json(res, 200, {
        project: newest.project,
        sessionId: newest.id,
        totalEvents: events.length,
        events: slice,
        meta,
        status,
      });
    }
    if (pathname === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 3000\n\n");
      res.write("data: " + JSON.stringify({ type: "hello", startup: STARTUP_ID }) + "\n\n");
      sseClients.add(res);
      const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
      req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }
    if (pathname === "/api/commands") {
      const limit = Number(parsed.query.limit) || 500;
      const q = parsed.query.q ? String(parsed.query.q) : "";
      return json(res, 200, readHistory(limit, q));
    }
    if (pathname === "/api/send" && req.method === "POST") {
      const chunks = [];
      let total = 0;
      let aborted = false;
      req.on("data", c => {
        total += c.length;
        if (total > MAX_UPLOAD_BYTES) { aborted = true; req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (aborted) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
        catch { return json(res, 400, { error: "bad json" }); }
        const text = String(body.text || "").replace(/\r/g, "").replace(/\n/g, " ").trim();
        const files = Array.isArray(body.files) ? body.files : [];
        const pendingId = body.pendingId ? String(body.pendingId) : null;
        if (!text && !files.length) return json(res, 400, { error: "empty" });
        const target = process.env.TMUX_TARGET || "";
        if (!target) return json(res, 500, { error: "TMUX_TARGET not set" });
        let saved;
        try {
          saved = files.map(saveFile).filter(Boolean);
        } catch (e) {
          return json(res, 500, { error: "save failed: " + e.message });
        }
        const r = queueMod.enqueue({ text, files: saved, pendingId });
        return json(res, 200, { ok: true, queued: true, id: r.id, position: r.position, files: saved.length });
      });
      return;
    }
    if (pathname === "/api/interrupt" && req.method === "POST") {
      const socket = process.env.TMUX_SOCKET || "/host-tmux/default";
      const target = process.env.TMUX_TARGET || "";
      if (!target) return json(res, 500, { error: "TMUX_TARGET not set" });
      sendInterrupt(socket, target)
        .then(() => {
          queueMod.markInterrupted();
          // Tell clients to flip UI to idle right away — JSONL won't reflect this.
          sseBroadcast({ type: "interrupted", ts: Date.now() });
          json(res, 200, { ok: true });
        })
        .catch(e => json(res, 500, { error: e.message }));
      return;
    }
    if (pathname === "/api/queue" && req.method === "GET") {
      return json(res, 200, { ok: true, queue: queueMod.snapshot() });
    }
    if (pathname === "/api/queue/cancel" && req.method === "POST") {
      const id = String(parsed.query.id || "");
      if (!id) return json(res, 400, { error: "missing id" });
      const ok = queueMod.cancel(id);
      return json(res, ok ? 200 : 409, { ok, error: ok ? null : "not found or already sending" });
    }
    if (pathname === "/api/queue/clear" && req.method === "POST") {
      const dropped = queueMod.clearAll();
      return json(res, 200, { ok: true, dropped });
    }
    if (pathname === "/api/usage") {
      fetchUsage().then(u => json(res, 200, u)).catch(e => json(res, 500, { ok: false, error: e.message }));
      return;
    }
    if (pathname === "/api/pane") {
      const socket = process.env.TMUX_SOCKET || "/host-tmux/default";
      const target = process.env.TMUX_TARGET || "";
      if (!target) return json(res, 500, { ok: false, error: "TMUX_TARGET not set" });
      capturePane(socket, target)
        .then(text => json(res, 200, { ok: true, text }))
        .catch(e => json(res, 500, { ok: false, error: e.message }));
      return;
    }
    if (pathname === "/api/send-config") {
      return json(res, 200, {
        target: process.env.TMUX_TARGET || "",
        socket: process.env.TMUX_SOCKET || "",
      });
    }
    if (pathname === "/healthz") {
      return json(res, 200, { ok: true });
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("error: " + e.message);
  }
}

module.exports = handle;
