const fs = require("node:fs");
const path = require("node:path");
const { CLAUDE_DIR } = require("./config");

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const CACHE_MS = 60 * 1000;
const CRED_FILE = path.join(CLAUDE_DIR, ".credentials.json");

let cache = null;

function readToken() {
  try {
    const j = JSON.parse(fs.readFileSync(CRED_FILE, "utf8"));
    return (j && j.claudeAiOauth && j.claudeAiOauth.accessToken) || null;
  } catch {
    return null;
  }
}

async function fetchUsage() {
  if (cache && (Date.now() - cache.fetchedAt) < CACHE_MS) return cache.payload;
  const token = readToken();
  if (!token) {
    const p = { ok: false, error: "no_token", fetchedAt: Date.now() };
    cache = { fetchedAt: Date.now(), payload: p };
    return p;
  }
  let payload;
  try {
    const r = await fetch(ENDPOINT, {
      headers: {
        "Authorization": "Bearer " + token,
        "anthropic-beta": "oauth-2025-04-20",
      },
    });
    if (r.status === 401) payload = { ok: false, error: "expired" };
    else if (!r.ok) payload = { ok: false, error: "http_" + r.status };
    else {
      const d = await r.json();
      payload = {
        ok: true,
        session: d.five_hour || null,
        week: d.seven_day || null,
      };
    }
  } catch (e) {
    payload = { ok: false, error: "net" };
  }
  payload.fetchedAt = Date.now();
  cache = { fetchedAt: Date.now(), payload };
  return payload;
}

module.exports = { fetchUsage };
