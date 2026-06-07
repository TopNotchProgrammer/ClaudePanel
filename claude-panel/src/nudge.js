const { sendText } = require("./tmux");

let active = false;
let condition = "";
let startedAt = null;

function start(opts) {
  const socket = process.env.TMUX_SOCKET || "/host-tmux/default";
  const target = process.env.TMUX_TARGET || "";
  if (!target) throw new Error("TMUX_TARGET not set");

  condition = String(opts.condition || "").trim();
  if (!condition) throw new Error("empty condition");

  active = true;
  startedAt = Date.now();

  sendText(socket, target, "/goal " + condition).catch(() => {});

  return status();
}

function stop() {
  const socket = process.env.TMUX_SOCKET || "/host-tmux/default";
  const target = process.env.TMUX_TARGET || "";

  if (active && target) {
    sendText(socket, target, "/goal clear").catch(() => {});
  }

  active = false;
  startedAt = null;
  return status();
}

function status() {
  return { active, condition, startedAt };
}

module.exports = { start, stop, status };
