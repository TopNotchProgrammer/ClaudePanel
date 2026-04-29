const fs = require("node:fs");
const path = require("node:path");
const { UPLOADS_DIR, UPLOADS_CLAUDE_PATH, MIME_TO_EXT } = require("./config");

try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) { console.error("[claude-panel] mkdir uploads failed:", e.message); }

// Wipe uploads on real container start (not on node --watch restart).
// Marker lives in /tmp, which is ephemeral per container but survives the
// in-container process restarts triggered by --watch.
const BOOT_MARKER = "/tmp/claude-panel-boot-marker";
if (!fs.existsSync(BOOT_MARKER)) {
  try {
    let n = 0;
    for (const f of fs.readdirSync(UPLOADS_DIR)) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, f)); n++; } catch {}
    }
    if (n) console.log("[claude-panel] wiped " + n + " uploads on boot");
    fs.writeFileSync(BOOT_MARKER, String(Date.now()));
  } catch (e) {
    console.error("[claude-panel] upload wipe failed:", e.message);
  }
}

function extFromName(name) {
  if (!name) return null;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : null;
}

function sanitizeExt(ext) {
  if (!ext) return "bin";
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

function saveFile(f) {
  if (!f || !f.data) return null;
  const m = /^data:([^;]+);base64,(.*)$/.exec(f.data);
  const b64 = m ? m[2] : f.data;
  const mime = (m ? m[1] : (f.type || "")).toLowerCase();
  const ext = sanitizeExt(extFromName(f.name) || MIME_TO_EXT[mime] || "bin");
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) return null;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const fname = ts + "-" + rand + "." + ext;
  fs.writeFileSync(path.join(UPLOADS_DIR, fname), buf);
  return {
    path: path.posix.join(UPLOADS_CLAUDE_PATH, fname),
    isImage: mime.startsWith("image/"),
  };
}

module.exports = { saveFile, extFromName, sanitizeExt };
