const http = require("node:http");

const ASR_URL = process.env.ASR_URL || "http://127.0.0.1:8000";

function synthesize(text) {
  const parsed = new URL(ASR_URL);
  const boundary = "----ttsbound" + Date.now().toString(36);

  const parts = [];
  parts.push(Buffer.from(
    "--" + boundary + "\r\n"
    + "Content-Disposition: form-data; name=\"text\"\r\n\r\n"
    + text + "\r\n"
  ));
  parts.push(Buffer.from("--" + boundary + "--\r\n"));
  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port || 8000,
      path: "/tts",
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
        if (res.statusCode !== 200) {
          reject(new Error("TTS error " + res.statusCode));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("TTS timeout")); });
    req.write(body);
    req.end();
  });
}

module.exports = { synthesize };
