const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 5000;

function runTmuxRaw(socket, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const p = spawn("tmux", ["-S", socket, ...args]);
    let out = "";
    let err = "";
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      try { p.kill("SIGKILL"); } catch {}
      reject(new Error("tmux timeout after " + timeoutMs + "ms"));
    }, timeoutMs);
    p.stdout.on("data", c => out += c);
    p.stderr.on("data", c => err += c);
    p.on("error", e => {
      if (done) return;
      done = true;
      clearTimeout(t);
      reject(e);
    });
    p.on("close", code => {
      if (done) return;
      done = true;
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error((err || "").trim() || ("tmux exit " + code)));
    });
  });
}

function runTmux(socket, args, timeoutMs) {
  return runTmuxRaw(socket, args, timeoutMs).then(() => undefined);
}

async function sendText(socket, target, text) {
  await runTmux(socket, ["send-keys", "-t", target, "-l", text]);
  await runTmux(socket, ["send-keys", "-t", target, "Enter"]);
}

async function sendInterrupt(socket, target) {
  await runTmux(socket, ["send-keys", "-t", target, "Escape"]);
}

const PANE_CACHE_TTL_MS = 500;
const paneCache = new Map();

async function capturePane(socket, target) {
  const key = socket + "\0" + target;
  const now = Date.now();
  const c = paneCache.get(key);
  if (c && now - c.ts < PANE_CACHE_TTL_MS) return c.text;
  const text = await runTmuxRaw(socket, ["capture-pane", "-p", "-t", target]);
  paneCache.set(key, { ts: now, text });
  return text;
}

module.exports = { runTmux, sendText, sendInterrupt, capturePane };
