const { sendText } = require("./tmux");

let nextId = 1;
const queue = [];
let workerBusy = false;
let periodicTimer = null;
let broadcaster = () => {};
let interruptedAt = 0;
const INTERRUPT_GRACE_MS = 60000;

function setBroadcaster(fn) {
  broadcaster = typeof fn === "function" ? fn : () => {};
}

function snapshot() {
  return queue.map(q => ({
    id: q.id,
    text: q.text,
    fileCount: q.files.length,
    createdAt: q.createdAt,
    sending: !!q.sending,
  }));
}

function broadcast(event, extra) {
  try { broadcaster({ type: "queue", event, queue: snapshot(), ...(extra || {}) }); } catch {}
}

function enqueue({ text, files, pendingId }) {
  const id = String(nextId++);
  queue.push({
    id,
    text: String(text || ""),
    files: Array.isArray(files) ? files : [],
    pendingId: pendingId || null,
    createdAt: Date.now(),
    sending: false,
  });
  broadcast("added", { id });
  triggerWork();
  return { id, position: queue.length };
}

function cancel(id) {
  const i = queue.findIndex(q => q.id === id);
  if (i < 0) return false;
  // Don't yank an item that's currently being dispatched mid-tmux-call.
  if (queue[i].sending) return false;
  queue.splice(i, 1);
  broadcast("cancelled", { id });
  return true;
}

function clearAll() {
  if (!queue.length) return 0;
  // Keep an in-flight item; drop the rest.
  const keep = queue.filter(q => q.sending);
  const dropped = queue.length - keep.length;
  queue.length = 0;
  for (const k of keep) queue.push(k);
  broadcast("cleared", { dropped });
  return dropped;
}

async function getStatus() {
  // Lazy require avoids load-order coupling.
  const { listSessions, detectStatus } = require("./sessions");
  const list = listSessions();
  if (!list.length) return "idle";
  return detectStatus(list[0].id, list[0].project);
}

async function isReady() {
  const status = await getStatus().catch(() => "idle");
  if (status === "idle") return true;
  // After an Esc interrupt, JSONL won't get an assistant turn for the aborted
  // request, so detectStatus will keep saying "thinking" until the 10-min cap.
  // Honor a short grace window where we trust the TUI is actually idle.
  if (interruptedAt && Date.now() - interruptedAt < INTERRUPT_GRACE_MS) return true;
  return false;
}

function markInterrupted() {
  interruptedAt = Date.now();
  triggerWork();
}

function wasRecentlyInterrupted() {
  return interruptedAt && (Date.now() - interruptedAt < INTERRUPT_GRACE_MS);
}

function buildText(item) {
  let text = item.text.replace(/\r/g, "").replace(/\n/g, " ").trim();
  if (item.files.length) {
    const suffix = item.files
      .map(f => (f.isImage ? `[image: ${f.path}]` : f.path))
      .join(" ");
    text = text ? `${text} ${suffix}` : suffix;
  }
  return text;
}

function triggerWork() {
  if (workerBusy) return;
  setImmediate(workLoop);
}

async function workLoop() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    while (queue.length) {
      const socket = process.env.TMUX_SOCKET || "/host-tmux/default";
      const target = process.env.TMUX_TARGET || "";
      if (!target) break;
      if (!(await isReady())) break;
      const item = queue[0];
      const text = buildText(item);
      if (!text) {
        // Empty after assembly — drop it.
        queue.shift();
        broadcast("dropped", { id: item.id, reason: "empty" });
        continue;
      }
      item.sending = true;
      broadcast("sending", { id: item.id });
      try {
        await sendText(socket, target, text);
      } catch (e) {
        item.sending = false;
        queue.shift();
        broadcast("error", { id: item.id, error: e.message });
        continue;
      }
      queue.shift();
      broadcast("sent", { id: item.id });
      // Consume the interrupt grace once we've dispatched after it.
      interruptedAt = 0;
      // Give the TUI time to register the keystrokes + flip status.
      await new Promise(r => setTimeout(r, 300));
    }
  } finally {
    workerBusy = false;
  }
}

function startPeriodic() {
  if (periodicTimer) return;
  // Fallback in case SSE tick is missed (Linux bind-mount fs.watch quirk).
  periodicTimer = setInterval(() => {
    if (queue.length && !workerBusy) triggerWork();
  }, 2000);
  if (periodicTimer.unref) periodicTimer.unref();
}

module.exports = {
  enqueue, cancel, clearAll, triggerWork, snapshot,
  setBroadcaster, startPeriodic, markInterrupted, wasRecentlyInterrupted,
};
