const http = require("node:http");

const ASR_URL = process.env.ASR_URL || "http://127.0.0.1:8000";

function transcribe(audioBuffer, mimeType, language) {
  if (!ASR_URL) return Promise.reject(new Error("ASR_URL not configured"));

  const parsed = new URL(ASR_URL);
  const boundary = "----asrbound" + Date.now().toString(36);

  const ext = mimeType.includes("webm") ? "webm"
    : mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("mp4") ? "mp4"
    : "wav";

  const parts = [];
  parts.push(Buffer.from(
    "--" + boundary + "\r\n"
    + "Content-Disposition: form-data; name=\"file\"; filename=\"audio." + ext + "\"\r\n"
    + "Content-Type: " + mimeType + "\r\n\r\n"
  ));
  parts.push(audioBuffer);
  parts.push(Buffer.from("\r\n"));
  parts.push(Buffer.from(
    "--" + boundary + "\r\n"
    + "Content-Disposition: form-data; name=\"language\"\r\n\r\n"
    + language + "\r\n"
  ));
  parts.push(Buffer.from("--" + boundary + "--\r\n"));

  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 8000,
      path: "/transcribe",
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "Content-Length": body.length,
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (res.statusCode !== 200) {
            reject(new Error(result.detail || result.error || "ASR error " + res.statusCode));
          } else {
            resolve(result);
          }
        } catch {
          reject(new Error("ASR response parse error"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("ASR timeout")); });
    req.write(body);
    req.end();
  });
}

function checkHealth() {
  if (!ASR_URL) return Promise.resolve({ ok: false });

  const parsed = new URL(ASR_URL);
  return new Promise((resolve) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 8000,
      path: "/health",
      method: "GET",
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { resolve({ ok: false }); }
      });
    });
    req.on("error", () => resolve({ ok: false }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false }); });
    req.end();
  });
}

module.exports = { transcribe, checkHealth };
