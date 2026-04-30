const { capturePane, sendInterrupt, invalidatePaneCache } = require("./tmux");

const watchers = new Map();
let nextId = 1;
let broadcaster = () => {};
const TICK_MS = 800;
const MAX_LIFETIME_MS = 5 * 60 * 1000;

function setBroadcaster(fn) {
  broadcaster = typeof fn === "function" ? fn : () => {};
}

function start({ socket, target, question }) {
  const id = "btw_" + (nextId++);
  const startedAt = Date.now();
  const w = { id, question, startedAt, lastText: "", timer: null, stopped: false, socket, target };
  watchers.set(id, w);

  const tick = async () => {
    if (w.stopped) return;
    if (Date.now() - startedAt > MAX_LIFETIME_MS) {
      stop(id, "timeout").catch(() => {});
      return;
    }
    let text = "";
    try {
      invalidatePaneCache();
      text = await capturePane(socket, target);
    } catch (e) {
      // tmux might be momentarily unavailable; keep trying.
    }
    if (!w.stopped && text != null) {
      const trimmed = trimToBtwOverlay(text);
      if (trimmed !== w.lastText) {
        w.lastText = trimmed;
        try { broadcaster({ type: "btw-tick", id, question, text: trimmed, ts: Date.now() }); } catch {}
      }
    }
    if (!w.stopped) w.timer = setTimeout(tick, TICK_MS);
  };

  w.timer = setTimeout(tick, 200);
  try { broadcaster({ type: "btw-start", id, question, ts: startedAt }); } catch {}
  return id;
}

async function stop(id, reason) {
  const w = watchers.get(id);
  if (!w || w.stopped) return false;
  w.stopped = true;
  if (w.timer) clearTimeout(w.timer);
  watchers.delete(id);
  let closed = false;
  if (reason === "user-close") {
    try { await sendInterrupt(w.socket, w.target); closed = true; } catch {}
  }
  try { broadcaster({ type: "btw-end", id, reason, closed, ts: Date.now() }); } catch {}
  return true;
}

// Pane buffer contains the whole TUI scrollback — main conversation above,
// then the /btw overlay header line ("/btw <question>"), then the side answer.
// Trim away everything above the last "/btw " line so the panel only shows
// the side-question content.
function trimToBtwOverlay(text) {
  if (!text) return text;
  const lines = text.split("\n");
  let cut = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    // Line may be prefixed with box-drawing chars or whitespace from the TUI.
    if (/(^|[^A-Za-z0-9])\/btw(\s|$)/.test(lines[i])) { cut = i; break; }
  }
  if (cut < 0) return text;
  return lines.slice(cut).join("\n");
}

function snapshot() {
  return Array.from(watchers.values()).map(w => ({
    id: w.id, question: w.question, startedAt: w.startedAt, text: w.lastText,
  }));
}

module.exports = { start, stop, snapshot, setBroadcaster };
