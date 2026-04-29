const fs = require("node:fs");
const { PROJECTS_DIR, HISTORY_FILE } = require("./config");

const sseClients = new Set();

function sseBroadcast(data) {
  const msg = "data: " + JSON.stringify(data) + "\n\n";
  for (const res of sseClients) {
    try { res.write(msg); } catch {}
  }
}

// Lazy-loaded to break the require cycle: queue requires sse for broadcast.
let _queue;
function pokeQueue() {
  try {
    if (!_queue) _queue = require("./queue");
    _queue.triggerWork();
  } catch {}
}

let sseDebounce = null;
let sseFollowup = null;
function scheduleTick() {
  if (!sseDebounce) {
    sseDebounce = setTimeout(() => {
      sseDebounce = null;
      sseBroadcast({ type: "tick", ts: Date.now() });
      pokeQueue();
    }, 60);
  }
  if (sseFollowup) clearTimeout(sseFollowup);
  sseFollowup = setTimeout(() => {
    sseFollowup = null;
    sseBroadcast({ type: "tick", ts: Date.now() });
    pokeQueue();
  }, 2000);
}

function startWatchers() {
  try {
    if (fs.existsSync(PROJECTS_DIR)) {
      fs.watch(PROJECTS_DIR, { recursive: true, persistent: false }, (_ev, filename) => {
        if (!filename || !filename.endsWith(".jsonl")) return;
        scheduleTick();
      });
    }
    if (fs.existsSync(HISTORY_FILE)) {
      fs.watch(HISTORY_FILE, { persistent: false }, () => scheduleTick());
    }
  } catch (e) {
    console.error("[claude-panel] fs.watch failed:", e.message);
  }
}

module.exports = { sseClients, sseBroadcast, scheduleTick, startWatchers };
