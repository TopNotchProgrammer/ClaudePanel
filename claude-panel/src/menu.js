// Detects selection menus in the Claude Code TUI (AskUserQuestion dialogs,
// plan approval, …) by parsing the tmux pane, and drives them with keys.
//
// JSONL is not usable here: the assistant entry with the AskUserQuestion
// tool_use is often flushed only after the user answers, so the pane is the
// only reliable source while the dialog is open.
//
// TUI behavior this relies on (verified on Claude Code 2.1.x):
// - Options render as "❯ 1. Label" (cursor) / "  2. Label", descriptions
//   indented below. Multi-select adds "[ ] " / "[✔] " and a "Submit" row.
// - Up/Down move the cursor over options (and the Submit row); Enter picks
//   an option (single), toggles it (multi) or activates Submit.
// - The free-text option ("Type something") is a text field: typing replaces
//   the placeholder, auto-checks it in multi-select; Enter confirms in single.
const { capturePane, invalidatePaneCache, sendSteps } = require("./tmux");
const { sseClients } = require("./sse");

const POLL_MS = 1000;
const OPTION_RE = /^(\s*)(❯\s*)?(\d+)\.\s+(.*)$/;
const SUBMIT_RE = /^\s*(❯)?\s*Submit\s*$/;
const RULE_RE = /^\s*[─━]{8,}\s*$/;
const FOOTER_RE = /Esc to cancel|Enter to (select|confirm)/;
const CHECK_RE = /^\[([ ✔✓xX])\]\s*/;
const PLACEHOLDER_RE = /^Type something\.?$/;

function parseMenu(pane) {
  const lines = String(pane || "").split("\n").map(l => l.replace(/\s+$/, ""));
  let cursor = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (OPTION_RE.test(lines[i]) && /^\s*❯/.test(lines[i])) { cursor = i; break; }
    if (SUBMIT_RE.test(lines[i]) && /❯/.test(lines[i])) { cursor = i; break; }
  }
  if (cursor < 0) return null;

  // Walk up from the cursor over option/description/blank lines to find where
  // the option block starts.
  const isBlockLine = l => !l.trim() || OPTION_RE.test(l) || SUBMIT_RE.test(l) || /^\s{4,}\S/.test(l);
  let start = cursor;
  while (start > 0 && isBlockLine(lines[start - 1])) start--;
  // Walk down to the footer / end of the dialog.
  let end = cursor;
  while (end + 1 < lines.length) {
    const l = lines[end + 1];
    if (FOOTER_RE.test(l)) break;
    if (!(isBlockLine(l) || RULE_RE.test(l))) break;
    end++;
  }
  const footerLine = end + 1 < lines.length && FOOTER_RE.test(lines[end + 1]) ? lines[end + 1].trim() : "";
  // A live menu is the last thing on screen. A numbered list echoed in the
  // transcript ("❯ 1. …" from a user message) has the prompt box below it.
  const below = lines.slice(end + 1).filter(l => l.trim());
  if (below.length > 2 || below.some(l => RULE_RE.test(l) || /^\s*❯/.test(l))) return null;

  const items = [];
  for (let i = start; i <= end; i++) {
    const l = lines[i];
    if (!l.trim() || RULE_RE.test(l)) continue;
    const m = l.match(OPTION_RE);
    if (m && m[1].length <= 4) {
      let label = m[4];
      let checked = null;
      const cm = label.match(CHECK_RE);
      if (cm) { checked = cm[1] !== " "; label = label.slice(cm[0].length); }
      items.push({ kind: "option", n: Number(m[3]), label: label.trim(), desc: "", checked, cursor: !!m[2] });
      continue;
    }
    const sm = l.match(SUBMIT_RE);
    if (sm) { items.push({ kind: "submit", label: "Submit", cursor: !!sm[1] }); continue; }
    const prev = items[items.length - 1];
    if (prev && prev.kind === "option") prev.desc = (prev.desc ? prev.desc + " " : "") + l.trim();
  }
  const options = items.filter(it => it.kind === "option");
  // Need a real list (1..N, N≥2) — a lone "❯ 1. foo" is just text in the prompt.
  if (options.length < 2 || options[0].n !== 1) return null;
  if (!options.every((o, i) => o.n === i + 1)) return null;

  // AskUserQuestion: the option right before "Chat about this" is the free-text field.
  const chat = options.find(o => /^Chat about this$/.test(o.label));
  if (chat) {
    const txt = options.find(o => o.n === chat.n - 1);
    if (txt) {
      txt.kind = "text";
      txt.value = PLACEHOLDER_RE.test(txt.label) ? "" : txt.label;
      txt.label = "Type something";
      txt.desc = "";
    }
  }

  // Header: everything between the rule above the dialog and the option block.
  // Blank lines are allowed inside it (review screen); capped so a missing
  // rule doesn't swallow the conversation.
  let hTop = start - 1;
  for (let k = 0; hTop >= 0 && k < 14; k++, hTop--) {
    if (RULE_RE.test(lines[hTop])) break;
  }
  const headerLines = lines.slice(hTop + 1, start).filter(l => l.trim());
  let tabs = null;
  if (headerLines.length && /^\s*←.*→\s*$/.test(headerLines[0])) {
    tabs = headerLines.shift().replace(/^\s*←\s*|\s*→\s*$/g, "").trim();
  }

  const menu = {
    tabs,
    header: headerLines.map(l => l.trim()).join("\n"),
    multi: items.some(it => it.checked != null),
    items: items.map((it, idx) => ({ ...it, idx })),
    footer: footerLine,
  };
  menu.sig = signature(menu);
  return menu;
}

// Identity of the screen (ignores cursor + checkbox state, which the panel
// itself changes). Used to reject actions aimed at a menu that is gone.
function signature(menu) {
  return JSON.stringify([menu.tabs && menu.tabs.replace(/[☐☒✔]/g, ""), menu.header, menu.items.map(i => i.kind + ":" + (i.kind === "text" ? "" : i.label))]);
}

let current = null;
let currentJson = "null";
let broadcaster = () => {};
let timer = null;
let target = { socket: "", target: "" };

function setBroadcaster(fn) { broadcaster = typeof fn === "function" ? fn : () => {}; }
function getCurrent() { return current; }

async function refresh() {
  if (!target.target) return current;
  let menu = null;
  try { menu = parseMenu(await capturePane(target.socket, target.target)); } catch {}
  const json = JSON.stringify(menu);
  if (json !== currentJson) {
    current = menu;
    currentJson = json;
    try { broadcaster({ type: "menu", menu }); } catch {}
  }
  return current;
}

function start(socket, tmuxTarget) {
  target = { socket, target: tmuxTarget };
  if (timer || !tmuxTarget) return;
  const tick = async () => {
    // Keep a stale-free state for the queue even without viewers, but poll
    // lazily then — capture-pane is a process spawn.
    await refresh();
    timer = setTimeout(tick, sseClients.size ? POLL_MS : POLL_MS * 5);
  };
  timer = setTimeout(tick, 500);
}

function navSteps(menu, toIdx) {
  const from = menu.items.findIndex(i => i.cursor);
  const d = toIdx - (from < 0 ? 0 : from);
  const key = d > 0 ? "Down" : "Up";
  return Array.from({ length: Math.abs(d) }, () => ({ key }));
}

// action: {type:"select", idx} | {type:"text", idx, text} | {type:"key", key}
const EXTRA_KEYS = new Set(["Escape", "Left", "Right", "Tab", "BTab"]);
async function act(sig, action) {
  invalidatePaneCache();
  const menu = await refresh();
  if (!menu || menu.sig !== sig) return { ok: false, status: 409, error: "menu changed" };
  let steps;
  if (action.type === "key") {
    if (!EXTRA_KEYS.has(action.key)) return { ok: false, status: 400, error: "bad key" };
    steps = [{ key: action.key }];
  } else {
    const item = menu.items[action.idx];
    if (!item) return { ok: false, status: 400, error: "bad idx" };
    steps = navSteps(menu, item.idx);
    if (action.type === "text") {
      if (item.kind !== "text") return { ok: false, status: 400, error: "not a text option" };
      const text = String(action.text || "").replace(/[\r\n]+/g, " ").trim();
      if (!text) return { ok: false, status: 400, error: "empty text" };
      for (let k = 0; k < (item.value || "").length; k++) steps.push({ key: "BSpace" });
      steps.push({ literal: text });
      if (!menu.multi) steps.push({ key: "Enter" });
    } else if (action.type === "select") {
      steps.push({ key: "Enter" });
    } else {
      return { ok: false, status: 400, error: "bad action" };
    }
  }
  await sendSteps(target.socket, target.target, steps);
  invalidatePaneCache();
  await new Promise(r => setTimeout(r, 250));
  await refresh();
  return { ok: true, menu: current };
}

module.exports = { parseMenu, start, refresh, act, getCurrent, setBroadcaster };
