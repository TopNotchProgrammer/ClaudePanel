const path = require("node:path");
const { PROJECTS_DIR } = require("./config");
const { listSessions, getRawEvents } = require("./sessions");
const { sendText, runTmux, invalidatePaneCache } = require("./tmux");

const MODELS = [
  { id: "opus", label: "Opus (latest)" },
  { id: "sonnet", label: "Sonnet (latest)" },
  { id: "haiku", label: "Haiku (latest)" },
  { id: "fable", label: "Fable (latest)" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "claude-fable-5", label: "Fable 5" },
];

// Set when the user switches via the panel. /model doesn't write to JSONL,
// so until the newly selected model produces an assistant turn, JSONL still
// reports the old one — prefer the switch until a newer event confirms.
let switched = null; // { model, ts }

function getCurrentModel() {
  const sessions = listSessions();
  if (!sessions.length) return switched ? switched.model : null;
  const newest = sessions[0];
  const file = path.join(PROJECTS_DIR, newest.project, newest.id + ".jsonl");
  const events = getRawEvents(file);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev && ev.message && ev.message.model) {
      const evTs = ev.timestamp ? Date.parse(ev.timestamp) : 0;
      if (switched && switched.ts > evTs) return switched.model;
      switched = null;
      return ev.message.model;
    }
  }
  return switched ? switched.model : null;
}

async function switchModel(modelId, socket, target) {
  await sendText(socket, target, "/model " + modelId);
  switched = { model: modelId, ts: Date.now() };
  // Claude Code may show a confirmation dialog ("switch model? the new model
  // will re-read the whole history") that blocks the TUI until answered.
  // Confirm it with Enter — on an empty input box an extra Enter is a no-op,
  // so this is safe when no dialog appears.
  await new Promise(r => setTimeout(r, 1200));
  await runTmux(socket, ["send-keys", "-t", target, "Enter"]);
  invalidatePaneCache();
}

module.exports = { MODELS, getCurrentModel, switchModel };
