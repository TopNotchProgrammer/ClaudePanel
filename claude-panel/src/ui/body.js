module.exports = `
<header>
  <div class="row">
    <a id="back" class="back" href="#" style="display:none">‹</a>
    <h1 id="title">Claude panel</h1>
    <span class="spacer"></span>
    <span id="working-indicator" class="pill" style="display:none"><span class="spin"></span><span class="label"></span></span>
    <span id="send-status" class="pill" style="display:none"></span>
    <span id="queue-status" class="pill" style="display:none"></span>
    <span id="counter" class="pill"></span>
  </div>
  <div id="tabs-wrap" class="tabs">
    <button class="tab tab-icon active" data-view="latest" aria-label="najnowsze" title="najnowsze">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 15.5 13.5"/></svg>
    </button>
    <button class="tab tab-icon" id="terminal-toggle" type="button" aria-label="terminal" title="terminal">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="6 9 9 12 6 15"/><line x1="12" y1="15" x2="16" y2="15"/></svg>
    </button>
    <button class="tab tab-icon" data-view="sessions" aria-label="sesje" title="sesje">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
    </button>
    <button class="tab tab-icon" data-view="commands" aria-label="komendy" title="komendy">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
    </button>
    <span class="tab-spacer"></span>
    <button class="tab tab-icon" id="info-toggle" type="button" aria-label="info" style="display:none">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="11"/><circle cx="12" cy="8" r=".6" fill="currentColor"/></svg>
    </button>
    <button class="tab tab-icon" id="pane-toggle" type="button" aria-label="podgląd CLI" title="podgląd CLI">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    <button class="tab tab-icon" id="reload-toggle" type="button" aria-label="odśwież" title="odśwież">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
    </button>
    <button class="tab tab-icon" id="search-toggle" type="button" aria-label="szukaj">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    </button>
  </div>
  <div id="usage-strip" class="usage-strip" style="display:none">
    <div class="usage-row" id="usage-session">
      <span class="usage-label">sesja</span>
      <div class="usage-bar"><div class="usage-fill"></div></div>
      <span class="usage-pct">—</span>
      <span class="usage-reset"></span>
    </div>
    <div class="usage-row" id="usage-week">
      <span class="usage-label">tydzień</span>
      <div class="usage-bar"><div class="usage-fill"></div></div>
      <span class="usage-pct">—</span>
      <span class="usage-reset"></span>
    </div>
  </div>
  <div id="search-wrap" class="row" style="display:none;margin-top:8px">
    <input id="q" type="search" placeholder="szukaj…" autocomplete="off">
  </div>
  <div id="filter-wrap" class="tabs" style="display:none">
    <select id="filter-select" class="filter-select">
      <option value="all">wszystko</option>
      <option value="user">user</option>
      <option value="assistant">claude</option>
      <option value="tool_use">narzędzia</option>
      <option value="tool_result">wyniki</option>
      <option value="thinking">myślenie</option>
    </select>
  </div>
  <div id="info-panel" class="info-panel hidden"></div>
</header>
<main id="main"></main>
<div id="pane-preview" class="pane-preview" style="display:none"><pre id="pane-preview-pre"></pre></div>
<form id="send-form" class="send-form" style="display:none" autocomplete="off">
  <div class="send-inner">
    <div id="attachments" class="attachments"></div>
    <div class="send-row">
      <button id="attach-btn" type="button" class="icon-btn" aria-label="załącz plik" title="załącz plik">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input id="attach-input" type="file" multiple style="display:none">
      <button id="interrupt-btn" type="button" class="icon-btn interrupt-btn" aria-label="przerwij claude" title="przerwij claude" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      </button>
      <textarea id="send-text" rows="1"></textarea>
      <button id="send-btn" class="submit" type="submit">wyślij</button>
    </div>
  </div>
</form>
`;
