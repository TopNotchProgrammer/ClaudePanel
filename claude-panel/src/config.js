const path = require("node:path");

const CLAUDE_DIR = process.env.CLAUDE_DIR || "/home/node/.claude";
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");
const HISTORY_FILE = path.join(CLAUDE_DIR, "history.jsonl");
const PORT = Number(process.env.PORT) || 8080;
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/tmp/claude-panel-uploads";
const UPLOADS_CLAUDE_PATH = process.env.UPLOADS_CLAUDE_PATH || UPLOADS_DIR;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const STARTUP_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const LANG = (process.env.PANEL_LANG === "en" || process.env.PANEL_LANG === "pl") ? process.env.PANEL_LANG : "pl";

const MIME_TO_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/json": "json",
  "application/zip": "zip",
  "application/x-tar": "tar",
  "application/gzip": "gz",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/html": "html",
  "text/css": "css",
  "application/javascript": "js",
  "application/typescript": "ts",
  "application/xml": "xml",
  "text/xml": "xml",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

module.exports = {
  CLAUDE_DIR,
  PROJECTS_DIR,
  HISTORY_FILE,
  PORT,
  UPLOADS_DIR,
  UPLOADS_CLAUDE_PATH,
  MAX_UPLOAD_BYTES,
  STARTUP_ID,
  LANG,
  MIME_TO_EXT,
};
