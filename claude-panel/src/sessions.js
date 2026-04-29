const fs = require("node:fs");
const path = require("node:path");
const { PROJECTS_DIR, HISTORY_FILE } = require("./config");

function readJSONL(file) {
  const raw = fs.readFileSync(file, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

const rawCache = new Map();
const MAX_CACHE = 64;
function getRawEvents(file) {
  let st;
  try { st = fs.statSync(file); } catch { return []; }
  const key = file;
  const cached = rawCache.get(key);
  if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) return cached.raw;
  const raw = readJSONL(file);
  rawCache.set(key, { mtime: st.mtimeMs, size: st.size, raw });
  if (rawCache.size > MAX_CACHE) {
    const firstKey = rawCache.keys().next().value;
    rawCache.delete(firstKey);
  }
  return raw;
}

function listSessions() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  const projects = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
  const sessions = [];
  for (const p of projects) {
    const dir = path.join(PROJECTS_DIR, p.name);
    let entries;
    try { entries = fs.readdirSync(dir).filter(f => f.endsWith(".jsonl")); } catch { continue; }
    for (const f of entries) {
      const full = path.join(dir, f);
      try {
        const st = fs.statSync(full);
        sessions.push({
          id: f.replace(/\.jsonl$/, ""),
          project: p.name,
          size: st.size,
          mtime: st.mtimeMs,
        });
      } catch {}
    }
  }
  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions;
}

function firstText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const b of content) {
      if (typeof b === "string") return b;
      if (b && b.type === "text" && b.text) return b.text;
    }
  }
  return "";
}

function stripMarkup(s, opts) {
  if (!s) return "";
  const keepCmd = opts && opts.keepCmd;
  let out = s
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  if (keepCmd) {
    out = out.replace(/<command-name>([\s\S]*?)<\/command-name>/g, (_, n) => {
      const t = n.trim();
      return t.startsWith("/") ? t : "/" + t;
    });
  } else {
    out = out.replace(/<command-name>[\s\S]*?<\/command-name>/g, "");
  }
  return out.replace(/<[^>]+>/g, "").trim();
}

function summarizeSession(id, project) {
  const file = path.join(PROJECTS_DIR, project, id + ".jsonl");
  const events = getRawEvents(file);
  let firstUser = "";
  let userCount = 0;
  let asstCount = 0;
  let toolCount = 0;
  let firstTs = null;
  let lastTs = null;
  let cwd = null;
  let gitBranch = null;
  for (const e of events) {
    if (e.timestamp) {
      const t = Date.parse(e.timestamp);
      if (!Number.isNaN(t)) {
        if (firstTs == null || t < firstTs) firstTs = t;
        if (lastTs == null || t > lastTs) lastTs = t;
      }
    }
    if (e.cwd && !cwd) cwd = e.cwd;
    if (e.gitBranch && !gitBranch) gitBranch = e.gitBranch;
    if (e.type === "user" && !e.isMeta) {
      const raw = firstText(e.message?.content);
      const clean = stripMarkup(raw);
      if (clean && !firstUser) firstUser = clean.slice(0, 240);
      if (typeof e.message?.content === "string") userCount++;
    } else if (e.type === "user" && e.isMeta) {
      // skip
    } else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      let hasText = false;
      for (const b of e.message.content) {
        if (b.type === "text") hasText = true;
        if (b.type === "tool_use") toolCount++;
      }
      if (hasText) asstCount++;
    }
  }
  return { id, project, firstUser, userCount, asstCount, toolCount, firstTs, lastTs, cwd, gitBranch };
}

function parseSession(id, project) {
  const file = path.join(PROJECTS_DIR, project, id + ".jsonl");
  const events = getRawEvents(file);
  const out = [];
  for (const e of events) {
    const ts = e.timestamp || null;
    if (e.type === "user" && !e.isMeta) {
      const c = e.message?.content;
      if (typeof c === "string") {
        const clean = stripMarkup(c, { keepCmd: true });
        if (clean) out.push({ kind: "user", text: clean, ts });
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (block.type === "tool_result") {
            let content = block.content;
            if (Array.isArray(content)) content = content.map(x => x.text || "").join("\n");
            out.push({ kind: "tool_result", refId: block.tool_use_id, text: String(content ?? ""), isError: !!block.is_error, ts });
          } else if (block.type === "text" && block.text) {
            out.push({ kind: "user", text: block.text, ts });
          }
        }
      }
    } else if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      for (const block of e.message.content) {
        if (block.type === "text" && block.text) {
          out.push({ kind: "assistant", text: block.text, ts });
        } else if (block.type === "tool_use") {
          out.push({ kind: "tool_use", name: block.name, input: block.input, id: block.id, ts });
        } else if (block.type === "thinking" && block.thinking) {
          out.push({ kind: "thinking", text: block.thinking, ts });
        }
      }
    } else if (e.type === "system" && e.content) {
      const clean = stripMarkup(e.content);
      if (clean) out.push({ kind: "system", text: clean, ts });
    }
  }
  return out;
}

function detectStatus(id, project) {
  const file = path.join(PROJECTS_DIR, project, id + ".jsonl");
  const events = getRawEvents(file);
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "assistant" && Array.isArray(e.message?.content)) {
      const hasToolUse = e.message.content.some(b => b.type === "tool_use");
      return hasToolUse ? "working" : "idle";
    }
    if (e.type === "user" && !e.isMeta) {
      const c = e.message?.content;
      if (Array.isArray(c) && c.some(b => b && b.type === "tool_result")) {
        return "working";
      }
      // Skip slash-command / caveat wrappers (e.g. /clear) — these are
      // meta-entries Claude Code writes around commands, not real prompts,
      // so they shouldn't leave a "thinking" pill stuck on the session.
      if (typeof c === "string" && !stripMarkup(c)) continue;
      // Plain user message with no assistant response yet → Claude is
      // thinking/processing. Cap at 2 min: covers normal first-token latency
      // but avoids "myślę" sticking forever on interrupted/abandoned sessions.
      if (e.timestamp) {
        const age = Date.now() - Date.parse(e.timestamp);
        if (age > 2 * 60 * 1000) return "idle";
      }
      return "thinking";
    }
  }
  return "idle";
}

function readHistory(limit, query) {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const entries = getRawEvents(HISTORY_FILE);
  let out = entries.map(e => ({
    display: e.display || "",
    timestamp: e.timestamp || 0,
    project: e.project || "",
    sessionId: e.sessionId || "",
  }));
  if (query) {
    const q = query.toLowerCase();
    out = out.filter(e => e.display.toLowerCase().includes(q));
  }
  out.sort((a, b) => b.timestamp - a.timestamp);
  if (limit) out = out.slice(0, limit);
  return out;
}

module.exports = {
  listSessions,
  summarizeSession,
  parseSession,
  detectStatus,
  readHistory,
  getRawEvents,
  stripMarkup,
  firstText,
};
