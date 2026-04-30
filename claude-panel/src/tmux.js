const { spawn } = require("node:child_process");
const fs = require("node:fs");

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

// Serializes all send-keys input so the queue worker and /btw can't interleave
// keystrokes inside the TUI input box.
let sendChain = Promise.resolve();
async function sendText(socket, target, text) {
  const next = sendChain.then(async () => {
    await runTmux(socket, ["send-keys", "-t", target, "-l", text]);
    await runTmux(socket, ["send-keys", "-t", target, "Enter"]);
  });
  sendChain = next.catch(() => {});
  return next;
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

function invalidatePaneCache() {
  paneCache.clear();
}

const START_CACHE_TTL_MS = 2000;
let startCache = { ts: 0, val: null };

// /proc/<pid> directory mtime is NOT process start time — the kernel updates
// it as the process runs, so it drifts toward "now". Read field 22 (starttime,
// in clock ticks since boot) from /proc/<pid>/stat and convert via /proc/uptime.
const CLK_TCK = 100; // _SC_CLK_TCK is 100 on every Linux we ship to (x86_64/arm64)

// Returns the wall-clock ms at which the claude process running in the target
// pane started. Requires the panel to share a PID namespace with the tmux
// server's container (so /proc/<pid> resolves). On any failure, returns null
// and the caller should fall back to not filtering.
async function getClaudeStartedAtMs(socket, target) {
  const now = Date.now();
  if (now - startCache.ts < START_CACHE_TTL_MS) return startCache.val;
  let val = null;
  try {
    const out = await runTmuxRaw(socket, ["display", "-p", "-t", target, "#{pane_pid}"]);
    const pid = parseInt(String(out).trim(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
      // Field 2 (comm) is in parens and may itself contain spaces or parens;
      // skip past the LAST ')' before splitting.
      const close = stat.lastIndexOf(")");
      const tail = close >= 0 ? stat.slice(close + 2) : "";
      const fields = tail.split(" ");
      // After the closing paren the next field is state (= field 3).
      // starttime = field 22, so index = 22 - 3 = 19.
      const starttimeTicks = parseInt(fields[19], 10);
      const uptimeStr = fs.readFileSync("/proc/uptime", "utf8");
      const uptimeSec = parseFloat(uptimeStr.split(" ")[0]);
      if (Number.isFinite(starttimeTicks) && Number.isFinite(uptimeSec)) {
        const bootMs = now - uptimeSec * 1000;
        val = bootMs + (starttimeTicks / CLK_TCK) * 1000;
      }
    }
  } catch {}
  startCache = { ts: now, val };
  return val;
}

module.exports = { runTmux, sendText, sendInterrupt, capturePane, invalidatePaneCache, getClaudeStartedAtMs };
