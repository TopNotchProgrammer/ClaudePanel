module.exports = (t) => `
:root{
  --bg:#0d1117; --panel:#161b22; --panel2:#1c222b; --border:#30363d;
  --text:#e6edf3; --muted:#8b949e; --accent:#58a6ff;
  --user:#7ee787; --asst:#e6edf3; --tool:#ffa657; --err:#ff7b72; --sys:#d2a8ff;
  --radius:8px;
}
*{box-sizing:border-box}
*{scrollbar-width:thin;scrollbar-color:#30363d #0d1117}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:#0d1117}
::-webkit-scrollbar-thumb{background:#30363d;border-radius:6px;border:2px solid #0d1117}
::-webkit-scrollbar-thumb:hover{background:#484f58}
::-webkit-scrollbar-corner{background:#0d1117}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}
html,body{height:100vh;height:100dvh;overflow:hidden}
body{display:flex;flex-direction:column}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
header{flex:0 0 auto;background:var(--bg);border-bottom:1px solid var(--border);padding:10px 14px 10px 10px;z-index:10;max-height:60vh;overflow-y:auto}
header .row{display:flex;gap:10px;align-items:center;min-height:36px}
header h1{margin:0;font-size:17px;font-weight:600}
header .crumbs{font-size:13px;color:var(--muted)}
.back{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;margin:-10px 0 -10px -10px;padding:0 10px;color:var(--accent);font-size:22px}
.spacer{flex:1}
main{flex:1 1 auto;overflow-y:auto;padding:12px 12px 32px 12px;width:100%;max-width:860px;margin:0 auto}
input[type=search]{width:100%;background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px 12px;font:inherit;outline:none}
input[type=search]:focus{border-color:var(--accent)}
.tabs{display:flex;gap:6px;margin:10px 0 4px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.tab{flex:0 0 auto;padding:7px 12px;border:1px solid var(--border);border-radius:8px;color:var(--muted);font-size:13px;background:transparent;cursor:pointer;white-space:nowrap}
.tab.active{background:var(--panel);color:var(--text);border-color:var(--accent)}
.tab-icon{padding:7px 10px;display:inline-flex;align-items:center;justify-content:center}
.tab-icon.has-query,.tab-icon.active{border-color:var(--accent);color:var(--accent)}
.tab-spacer{flex:1 1 auto}
.info-panel{margin-top:8px}
.info-panel.hidden{display:none}
.info-panel .session{margin:0}
.filter-select{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:100%;padding:9px 36px 9px 12px;border:1px solid var(--accent);border-radius:8px;background-color:var(--panel);background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2358a6ff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");background-repeat:no-repeat;background-position:right 14px center;background-size:12px;color:var(--text);font:inherit;font-size:13px;cursor:pointer;outline:none;min-height:36px}
.filter-select:focus{box-shadow:0 0 0 2px rgba(88,166,255,.25)}
.filter-select option{background:var(--panel);color:var(--text)}
.session{display:block;padding:12px 14px;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);margin:10px 0;color:inherit}
.session:hover{border-color:var(--accent);text-decoration:none}
.session .title{font-weight:600;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.session .meta{font-size:12px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.session .meta .tag{padding:1px 7px;border-radius:8px;background:var(--panel2);border:1px solid var(--border)}
.empty{color:var(--muted);padding:40px 10px;text-align:center}
.event{border-left:3px solid var(--border);padding:8px 10px 8px 12px;margin:8px 0;background:var(--panel);border-radius:0 var(--radius) var(--radius) 0}
.event .h{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.event .h .k{font-weight:700}
.event.user{border-left-color:var(--user)} .event.user .k{color:var(--user)}
.event.assistant{border-left-color:var(--asst)} .event.assistant .k{color:var(--asst)}
.event.tool_use{border-left-color:var(--tool)} .event.tool_use .k{color:var(--tool)}
.event.tool_result{border-left-color:var(--tool);background:var(--panel2)} .event.tool_result .k{color:var(--tool)}
.event.tool_result.err{border-left-color:var(--err)} .event.tool_result.err .k{color:var(--err)}
.event.system{border-left-color:var(--sys)} .event.system .k{color:var(--sys)}
.event.thinking{border-left-color:#555;opacity:.75} .event.thinking .k{color:var(--muted)}
.event.pending{opacity:.55;border-left-style:dashed}
.event.pending .k::after{content:" · ${t.statusInQueue}";color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;font-style:italic}
.event.pending.p-sending .k::after{content:" · ${t.statusSending}"}
.event.pending.p-sent{opacity:.7;border-left-style:solid}
.event.pending.p-sent .k::after{content:" · ${t.statusSentWaiting}"}
.event.pending.stuck{opacity:.85;border-left-color:var(--err)}
.event.pending.stuck .k::after{content:" · ${t.statusNoResponse}";color:var(--err);font-style:italic}
.event.pending.errored{opacity:.85;border-left-color:var(--err)}
.event.pending.errored .k::after{content:" · ${t.statusSendError}";color:var(--err);font-style:italic}
.pending-cancel{margin-left:auto;background:transparent;border:0;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:0 6px;border-radius:4px}
.pending-cancel:hover{background:var(--panel2);color:var(--err)}
.pending-retry{background:transparent;border:0;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;padding:2px 8px;border-radius:4px}
.pending-retry:hover{background:var(--panel2);color:var(--accent)}
.send-form .icon-btn.interrupt-btn:not(:disabled){color:var(--err);border-color:var(--err)}
.send-form .icon-btn.interrupt-btn:not(:disabled):hover{background:var(--err);color:#fff}
.send-form .icon-btn.interrupt-btn:disabled{opacity:.35;cursor:not-allowed}
.send-form .icon-btn.interrupt-btn:disabled:hover{border-color:var(--border);color:var(--text)}
.event.btw{margin-left:0;border-left-color:var(--sys);background:rgba(210,168,255,.06)}
.event.btw .k{color:var(--sys)}
.event.btw .k::after{content:" · /btw";color:var(--muted);font-weight:400}
.event.btw.live .k::after{content:" · /btw · live"}
.event.btw.closed .k::after{content:" · /btw · ${t.btwClosed}"}
.event.btw .btw-q{margin:4px 0 6px;font-weight:500;color:var(--text)}
.event.btw pre.btw-pane{background:#000;color:#cdd9e5;border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin:0;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;overflow-x:auto;max-height:320px;overflow-y:auto}
body.btw-active main{padding:0;max-width:none;display:flex;flex-direction:column;overflow:hidden}
body.btw-active main > *{display:none}
body.btw-active main > .event.btw.live{display:flex;flex-direction:column;flex:1;min-height:0;margin:0;border:0;border-radius:0;background:var(--panel);padding:14px}
body.btw-active main > .event.btw.live pre.btw-pane{flex:1;min-height:0;max-height:none}
body.btw-active #send-form,body.btw-active #pane-preview{opacity:.4;pointer-events:none;filter:saturate(.5)}
.event.btw .btw-close-btn{font-size:24px;line-height:1;min-width:40px;min-height:40px;padding:0 10px;border:1px solid var(--border);background:var(--panel2);color:var(--text);display:inline-flex;align-items:center;justify-content:center;border-radius:8px}
.event.btw .btw-close-btn:hover{background:var(--err);color:#fff;border-color:var(--err)}
.event pre{margin:4px 0 0;white-space:pre-wrap;word-break:break-word;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--text)}
.event .body{white-space:pre-wrap;word-break:break-word}
.event .toolname{background:var(--panel2);border:1px solid var(--border);padding:1px 6px;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
details.more{margin-top:6px}
details.more summary{color:var(--muted);cursor:pointer;font-size:12px;list-style:none}
details.more summary::-webkit-details-marker{display:none}
details.more summary::before{content:"▸ "}
details.more[open] summary::before{content:"▾ "}
.long-wrap{position:relative}
.long-wrap.collapsed > .body,.long-wrap.collapsed > pre{max-height:24em;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,#000 80%,transparent 100%);mask-image:linear-gradient(180deg,#000 80%,transparent 100%)}
.long-wrap > .long-toggle{margin-top:6px;background:transparent;border:0;color:var(--muted);cursor:pointer;font-size:12px;padding:2px 0;display:inline-block;font:inherit;font-size:12px}
.long-wrap > .long-toggle:hover{color:var(--accent)}
.long-wrap.collapsed > .long-toggle::before{content:"▸ ${t.showAll}"}
.long-wrap:not(.collapsed) > .long-toggle::before{content:"▾ ${t.collapse}"}
.long-wrap > .long-toggle[data-len]::after{content:" (" attr(data-len) " ${t.charsSuffix})"}
.cmd{display:flex;flex-direction:column;gap:4px;padding:8px 10px;background:var(--panel);border:1px solid var(--border);border-radius:8px;margin:6px 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;color:inherit;text-decoration:none}
a.cmd:hover{border-color:var(--accent);text-decoration:none}
.cmd.nolink{opacity:.7}
.cmd .when{color:var(--muted);font-size:11px;font-family:system-ui,sans-serif;display:flex;gap:8px;align-items:center}
.cmd .when .sep{color:var(--border)}
.cmd .t{white-space:pre-wrap;word-break:break-word}
.event.focus{box-shadow:0 0 0 2px var(--accent);scroll-margin-top:180px}
.send-form{flex:0 0 auto;z-index:5;background:var(--bg);border-top:1px solid var(--border);padding:10px 12px calc(10px + env(safe-area-inset-bottom)) 12px;display:flex;gap:8px;align-items:flex-end;position:relative}
.send-form .send-inner{display:flex;flex-direction:column;gap:6px;width:100%;max-width:860px;margin:0 auto}
.send-form .send-row{display:flex;gap:8px;align-items:flex-end;width:100%}
.send-form textarea{flex:1;resize:none;height:40px;min-height:40px;max-height:140px;background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 12px;font:inherit;line-height:22px;outline:none;overflow-y:hidden}
.send-form textarea:focus{border-color:var(--accent)}
.send-form button.submit{background:var(--accent);color:#001229;border:0;border-radius:8px;padding:0 16px;font:inherit;font-weight:600;cursor:pointer;height:40px}
.send-form button:disabled{opacity:.5;cursor:not-allowed}
.send-form .icon-btn{background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.send-form .icon-btn:hover{border-color:var(--accent);color:var(--accent)}
.attachments{display:none;flex-wrap:wrap;gap:6px}
.attachments.show{display:flex}
.attach-thumb{position:relative;width:56px;height:56px;border-radius:6px;overflow:hidden;border:1px solid var(--border);background:var(--panel);flex-shrink:0}
.attach-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.attach-thumb .rm{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.75);color:#fff;border:0;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;min-height:0}
.attach-file{position:relative;max-width:200px;height:56px;padding:6px 28px 6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--panel);display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text);overflow:hidden;flex-shrink:0}
.attach-file svg{flex-shrink:0;width:18px;height:18px;color:var(--muted)}
.attach-file .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.attach-file .rm{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.75);color:#fff;border:0;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;min-height:0}
.send-form.drag-over::after{content:"${t.dropFile}";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(88,166,255,.12);border:2px dashed var(--accent);border-radius:8px;color:var(--accent);font-weight:600;pointer-events:none;z-index:2}
#live-dot{color:#7ee787;border-color:#7ee787;animation:pulse 1.4s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
.btn{display:inline-block;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--panel);color:var(--text);font:inherit;cursor:pointer}
.btn:hover{border-color:var(--accent)}
.loadmore{display:block;width:100%;margin:10px auto;text-align:center}
.pill{display:inline-block;padding:1px 7px;border-radius:8px;background:var(--panel2);border:1px solid var(--border);font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0}
.pill.working,.pill.thinking{display:inline-flex;align-items:center;gap:6px}
.pill.working{color:var(--tool);border-color:var(--tool)}
.pill.thinking{color:var(--sys);border-color:var(--sys)}
.pill.working .spin,.pill.thinking .spin{width:9px;height:9px;border:1.6px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}
.pill.send-ok{color:var(--user);border-color:var(--user)}
.pill.send-err{color:var(--err);border-color:var(--err)}
header h1{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (min-width:700px){main{padding:16px}}
.md,.event .body.md{white-space:normal;line-height:1.4}
.md > *:first-child{margin-top:0}
.md > *:last-child{margin-bottom:0}
.md h1,.md h2,.md h3{margin:8px 0 4px;font-weight:700;line-height:1.25}
.md h1{font-size:16px}
.md h2{font-size:15px}
.md h3{font-size:14px}
.md p{margin:10px 0}
.md ul,.md ol{margin:6px 0;padding-left:22px}
.md li{margin:0;line-height:1.4}
.md li > p{margin:0}
.md li + li{margin-top:3px}
.md code{background:var(--panel2);padding:0 4px;border-radius:3px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.88em;word-break:break-word}
.md pre{background:var(--panel2);padding:8px 10px;border-radius:6px;overflow-x:auto;margin:10px 0;line-height:1.4;font-size:12.5px;border:1px solid var(--border)}
.md pre code{background:transparent;padding:0;font-size:inherit;border-radius:0;word-break:normal}
.md a{color:var(--accent);text-decoration:underline}
.md blockquote{border-left:3px solid var(--border);padding:1px 10px;color:var(--muted);margin:3px 0}
.md hr{border:0;border-top:1px solid var(--border);margin:5px 0}
.md strong{font-weight:700}
.md em{font-style:italic}
.md table.md-table{border-collapse:collapse;margin:8px 0;font-size:13px;border:1px solid var(--border);max-width:100%;display:block;overflow-x:auto}
.md table.md-table th,.md table.md-table td{border:1px solid var(--border);padding:4px 8px;text-align:left;vertical-align:top}
.md table.md-table th{background:var(--panel2);font-weight:600;color:var(--text)}
.md table.md-table tbody tr:nth-child(even) td{background:rgba(255,255,255,.025)}
.md table.md-table code{background:var(--bg)}
.diff{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;background:var(--panel2);border:1px solid var(--border);border-radius:6px;margin:6px 0;padding:6px 0;overflow-x:auto}
.diff-add{display:block;padding:0 10px;background:rgba(126,231,135,.10);color:#7ee787;white-space:pre-wrap;word-break:break-word}
.diff-del{display:block;padding:0 10px;background:rgba(255,123,114,.10);color:#ff7b72;white-space:pre-wrap;word-break:break-word}
.diff-eq{display:block;padding:0 10px;color:var(--muted);white-space:pre-wrap;word-break:break-word}
.diff-skip{padding:4px 10px;color:var(--muted);font-style:italic;border-top:1px dashed var(--border);border-bottom:1px dashed var(--border);margin:2px 0}
.usage-strip{display:flex;gap:14px;margin:8px 0 0;padding-top:8px;border-top:1px dashed var(--border);font-size:11px;color:var(--muted);flex-wrap:wrap}
.usage-row{display:flex;gap:8px;align-items:center;flex:1 1 240px;min-width:0}
.usage-label{font-weight:600;color:var(--text);flex-shrink:0;width:46px}
.usage-bar{flex:1 1 auto;height:6px;background:var(--panel2);border:1px solid var(--border);border-radius:4px;overflow:hidden;min-width:60px}
.usage-fill{height:100%;background:var(--accent);transition:width .4s ease;width:0}
.usage-fill.warn{background:var(--tool)}
.usage-fill.crit{background:var(--err)}
.usage-pct{font-weight:600;color:var(--text);min-width:32px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}
.usage-reset{flex-shrink:0;font-size:10px;white-space:nowrap}
.usage-strip.error .usage-pct,.usage-strip.error .usage-reset{color:var(--err)}
.pane-preview{flex:0 0 auto;background:#000;border-top:1px solid var(--border);border-bottom:1px solid var(--border);max-height:180px;overflow-y:auto;display:flex;flex-direction:column-reverse}
.pane-preview pre{margin:0;padding:8px 12px;font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cdd9e5;white-space:pre;overflow-x:auto}
.pane-preview.err pre{color:var(--err)}
`;
