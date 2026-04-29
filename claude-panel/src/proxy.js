const http = require("node:http");
const net = require("node:net");

const TTYD_HOST = "127.0.0.1";
const TTYD_PORT = Number(process.env.TTYD_PORT) || 7681;

const INJECT_CSS = `
*{scrollbar-width:thin;scrollbar-color:#30363d #0d1117}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:#0d1117}
::-webkit-scrollbar-thumb{background:#30363d;border-radius:6px;border:2px solid #0d1117}
::-webkit-scrollbar-thumb:hover{background:#484f58}
::-webkit-scrollbar-corner{background:#0d1117}
body{background:#0d1117}
`.trim();

function isHtmlIndexPath(reqUrl) {
  const path = (reqUrl || "/").split("?")[0];
  return path === "/terminal" || path === "/terminal/";
}

function safeEnd(res, statusOrBody, body) {
  if (res.writableEnded || res.destroyed) return;
  try {
    if (typeof statusOrBody === "number") {
      if (!res.headersSent) res.writeHead(statusOrBody, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(body || "");
    } else {
      res.end(statusOrBody);
    }
  } catch {}
}

function proxyHttp(req, res) {
  const wantInject = isHtmlIndexPath(req.url);
  const headers = { ...req.headers, host: TTYD_HOST + ":" + TTYD_PORT };
  if (wantInject) headers["accept-encoding"] = "identity";

  const proxyReq = http.request(
    { host: TTYD_HOST, port: TTYD_PORT, method: req.method, path: req.url, headers },
    (proxyRes) => {
      const ct = proxyRes.headers["content-type"] || "";
      const inject = wantInject && /text\/html/i.test(ct);
      if (inject) {
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("error", () => safeEnd(res));
        proxyRes.on("end", () => {
          if (res.writableEnded || res.headersSent) return;
          try {
            let html = Buffer.concat(chunks).toString("utf8");
            const styleTag = "<style>" + INJECT_CSS + "</style>";
            html = html.includes("</head>")
              ? html.replace("</head>", styleTag + "</head>")
              : styleTag + html;
            const out = Buffer.from(html, "utf8");
            const outHeaders = { ...proxyRes.headers };
            delete outHeaders["content-length"];
            delete outHeaders["content-encoding"];
            delete outHeaders["transfer-encoding"];
            outHeaders["content-length"] = out.length;
            res.writeHead(proxyRes.statusCode, outHeaders);
            res.end(out);
          } catch (e) {
            safeEnd(res, 500, "inject error: " + e.message);
          }
        });
        return;
      }
      if (res.headersSent) return;
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (e) => safeEnd(res, 502, "ttyd niedostępne: " + e.message));
  req.on("error", () => { try { proxyReq.destroy(); } catch {} });
  req.pipe(proxyReq);
}

function proxyWs(req, clientSocket, head) {
  const upstream = net.connect(TTYD_PORT, TTYD_HOST, () => {
    let raw = req.method + " " + req.url + " HTTP/1.1\r\n";
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) {
        for (const item of v) raw += k + ": " + item + "\r\n";
      } else {
        raw += k + ": " + v + "\r\n";
      }
    }
    raw += "\r\n";
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
  const close = () => { try { upstream.destroy(); } catch {} try { clientSocket.destroy(); } catch {} };
  upstream.on("error", close);
  clientSocket.on("error", close);
}

module.exports = { proxyHttp, proxyWs };
