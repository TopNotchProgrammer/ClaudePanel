module.exports = `
const main = document.getElementById('main');
const titleEl = document.getElementById('title');
const backEl = document.getElementById('back');
const qEl = document.getElementById('q');
const counterEl = document.getElementById('counter');
const tabsWrap = document.getElementById('tabs-wrap');
const sendForm = document.getElementById('send-form');
const sendText = document.getElementById('send-text');
const sendBtn = document.getElementById('send-btn');
const sendStatusEl = document.getElementById('send-status');
const queueStatusEl = document.getElementById('queue-status');
const infoPanel = document.getElementById('info-panel');
const infoToggle = document.getElementById('info-toggle');
const workingEl = document.getElementById('working-indicator');
const interruptBtn = document.getElementById('interrupt-btn');
const paneToggle = document.getElementById('pane-toggle');
const panePreview = document.getElementById('pane-preview');
const panePreviewPre = document.getElementById('pane-preview-pre');

function syncViewportHeight(){
  const h=(window.visualViewport&&window.visualViewport.height)||window.innerHeight;
  document.body.style.height=h+'px';
}
window.addEventListener('resize',syncViewportHeight);
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',syncViewportHeight);
  window.visualViewport.addEventListener('scroll',syncViewportHeight);
}
syncViewportHeight();

function setStatus(status){
  const label = workingEl.querySelector('.label');
  if(status === 'working'){
    label.textContent = 'pracuję';
    workingEl.className = 'pill working';
    workingEl.style.display = '';
  } else if(status === 'thinking'){
    label.textContent = 'myślę';
    workingEl.className = 'pill thinking';
    workingEl.style.display = '';
  } else {
    workingEl.style.display = 'none';
  }
  if(interruptBtn) interruptBtn.disabled = !(status === 'working' || status === 'thinking');
}

function setInfoVisible(v){
  if(v){ infoPanel.classList.remove('hidden'); infoToggle.classList.add('active'); }
  else { infoPanel.classList.add('hidden'); infoToggle.classList.remove('active'); }
}
function setInfoButtonVisible(v){
  infoToggle.style.display = v ? '' : 'none';
  if(!v) setInfoVisible(false);
}
infoToggle.addEventListener('click',()=>{
  setInfoVisible(infoPanel.classList.contains('hidden'));
});
document.getElementById('reload-toggle').addEventListener('click',()=>{
  location.reload();
});
document.getElementById('terminal-toggle').addEventListener('click',()=>{
  window.open('/terminal/', '_blank', 'noopener');
});

function showToast(msg, kind){
  sendStatusEl.textContent = msg;
  sendStatusEl.className = 'pill ' + (kind==='ok' ? 'send-ok' : kind==='err' ? 'send-err' : '');
  sendStatusEl.style.display = '';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>{ sendStatusEl.style.display='none'; }, 2200);
}

const attachBtn = document.getElementById('attach-btn');
const attachInput = document.getElementById('attach-input');
const attachments = document.getElementById('attachments');
let pendingAttachments = [];

function renderAttachments(){
  attachments.classList.toggle('show', pendingAttachments.length > 0);
  attachments.innerHTML = pendingAttachments.map(a => {
    if(a.isImage){
      return '<div class="attach-thumb" data-id="'+a.id+'">'
        + '<img src="'+a.dataUrl+'" alt="'+esc(a.name)+'">'
        + '<button type="button" class="rm" data-rm="'+a.id+'" aria-label="usuń">×</button>'
        + '</div>';
    }
    return '<div class="attach-file" data-id="'+a.id+'" title="'+esc(a.name)+'">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
      + '<span class="name">'+esc(a.name)+'</span>'
      + '<button type="button" class="rm" data-rm="'+a.id+'" aria-label="usuń">×</button>'
      + '</div>';
  }).join('');
}
attachments.addEventListener('click',(e)=>{
  const id = e.target && e.target.dataset && e.target.dataset.rm;
  if(id){ pendingAttachments = pendingAttachments.filter(a=>a.id!==id); renderAttachments(); }
});

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=>resolve(r.result);
    r.onerror = ()=>reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

async function addFiles(files){
  for(const f of files){
    if(!f) continue;
    if(f.size > 15*1024*1024){ showToast('za duży plik (>15MB): '+f.name, 'err'); continue; }
    try{
      const dataUrl = await fileToDataUrl(f);
      const type = f.type || '';
      pendingAttachments.push({
        id: Math.random().toString(36).slice(2),
        name: f.name || 'plik',
        type,
        isImage: type.startsWith('image/'),
        dataUrl,
      });
    }catch(e){ showToast('błąd wczytania: '+e.message, 'err'); }
  }
  renderAttachments();
}

attachBtn.addEventListener('click', ()=> attachInput.click());
attachInput.addEventListener('change', async (e)=>{
  await addFiles(Array.from(e.target.files || []));
  attachInput.value = '';
});

sendText.addEventListener('paste', async (e)=>{
  const items = e.clipboardData && e.clipboardData.items;
  if(!items) return;
  const files = [];
  for(const it of items){
    if(it.kind === 'file'){
      const f = it.getAsFile();
      if(f) files.push(f);
    }
  }
  if(files.length){ e.preventDefault(); await addFiles(files); }
});

let dragDepth = 0;
sendForm.addEventListener('dragenter',(e)=>{
  if(!e.dataTransfer || !Array.from(e.dataTransfer.types||[]).includes('Files')) return;
  e.preventDefault(); dragDepth++; sendForm.classList.add('drag-over');
});
sendForm.addEventListener('dragover',(e)=>{
  if(!e.dataTransfer || !Array.from(e.dataTransfer.types||[]).includes('Files')) return;
  e.preventDefault();
});
sendForm.addEventListener('dragleave',(e)=>{
  if(!e.dataTransfer || !Array.from(e.dataTransfer.types||[]).includes('Files')) return;
  dragDepth = Math.max(0, dragDepth-1);
  if(dragDepth===0) sendForm.classList.remove('drag-over');
});
sendForm.addEventListener('drop', async (e)=>{
  e.preventDefault(); dragDepth = 0; sendForm.classList.remove('drag-over');
  const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
  if(files.length) await addFiles(files);
});

let messageQueue = [];
let isProcessing = false;
let serverQueueCount = 0;

function updateQueueIndicator(){
  const localActive = messageQueue.length + (isProcessing ? 1 : 0);
  const total = localActive + serverQueueCount;
  if(total === 0){
    queueStatusEl.style.display = 'none';
  } else {
    queueStatusEl.textContent = 'kolejka: ' + total;
    queueStatusEl.style.display = '';
  }
}

function enqueueMessage(){
  const text = sendText.value.trim();
  if(!text && !pendingAttachments.length) return;
  const files = pendingAttachments.map(a => ({ name: a.name, type: a.type, data: a.dataUrl }));
  const pendingId = Math.random().toString(36).slice(2);
  messageQueue.push({ text, files, pendingId, _pendingId: pendingId });
  if(state.feed && state.view==='latest'){
    const now = Date.now();
    const previewText = text || (files.length ? '['+files.length+' plik'+(files.length===1?'':'i')+']' : '');
    state.feed.events.push({
      kind: 'user',
      text: previewText,
      ts: new Date(now).toISOString(),
      _pending: true,
      _pendingId: pendingId,
      _pendingAt: now,
      _pendingHasFiles: files.length > 0,
      _pendingHasText: !!text,
    });
    state.lastRenderedMaxIndex = null;
    renderLatest({mode:'newer'});
  }
  sendText.value = '';
  sendText.style.height = '';
  sendText.style.overflowY = '';
  pendingAttachments = [];
  renderAttachments();
  updateQueueIndicator();
  if(!isProcessing) processQueue();
}

function findPendingByPid(pid){
  if(!state.feed) return null;
  return state.feed.events.find(e => e._pending && e._pendingId === pid) || null;
}
function findPendingByQid(qid){
  if(!state.feed) return null;
  return state.feed.events.find(e => e._pending && e._queueId === qid) || null;
}

function handleQueueEvent(d){
  serverQueueCount = Array.isArray(d.queue) ? d.queue.filter(q => !q.sending).length : 0;
  updateQueueIndicator();
  if(!state.feed) return;
  const events = state.feed.events;
  const ev = d.event;
  const id = d.id;
  let dirty = false;
  if(ev === 'sending'){
    const pe = findPendingByQid(id);
    if(pe && pe._serverState !== 'sending'){ pe._serverState = 'sending'; dirty = true; }
  } else if(ev === 'sent'){
    const pe = findPendingByQid(id);
    if(pe && pe._serverState !== 'sent'){ pe._serverState = 'sent'; dirty = true; }
  } else if(ev === 'cancelled' || ev === 'dropped'){
    const i = events.findIndex(e => e._pending && e._queueId === id);
    if(i >= 0){ events.splice(i, 1); dirty = true; }
  } else if(ev === 'error'){
    const pe = findPendingByQid(id);
    if(pe){ pe._error = d.error || 'błąd'; dirty = true; }
  } else if(ev === 'cleared'){
    // Drop any pending whose queue id is no longer in the snapshot.
    const liveIds = new Set((d.queue||[]).map(q => q.id));
    for(let i = events.length - 1; i >= 0; i--){
      const e = events[i];
      if(e._pending && e._queueId && !liveIds.has(e._queueId)){ events.splice(i,1); dirty = true; }
    }
  }
  if(dirty){
    state.lastRenderedMaxIndex = null;
    if(state.view === 'latest') renderLatest({mode:'newer'});
  }
}

function flipToIdle(){
  if(state.feed) state.feed.status = 'idle';
  setStatus('idle');
}
if(interruptBtn) interruptBtn.addEventListener('click', ()=>{
  if(interruptBtn.disabled) return;
  fetch('/api/interrupt', {method:'POST'})
    .then(r=>r.json().catch(()=>({})))
    .then(d=>{
      if(d && d.ok){ flipToIdle(); showToast('przerwano', 'ok'); }
      else showToast('błąd: '+((d && d.error) || ''), 'err');
    })
    .catch(e=>showToast('błąd: '+e.message, 'err'));
});
function dismissPendingLocal(pid){
  if(!state.feed) return;
  const i = state.feed.events.findIndex(e => e._pending && e._pendingId === pid);
  if(i < 0) return;
  state.feed.events.splice(i, 1);
  state.lastRenderedMaxIndex = null;
  if(state.view === 'latest') renderLatest({mode:'newer'});
}
document.addEventListener('click',(e)=>{
  const t = e.target && e.target.closest && e.target.closest('.long-toggle');
  if(!t) return;
  e.preventDefault();
  const wrap = t.closest('.long-wrap');
  if(wrap) wrap.classList.toggle('collapsed');
});
document.addEventListener('click', (e)=>{
  const btn = e.target && e.target.closest && e.target.closest('.pending-cancel');
  if(!btn) return;
  e.preventDefault();
  const localPid = btn.dataset.localPid;
  if(localPid){ dismissPendingLocal(localPid); return; }
  const id = btn.dataset.cancelId;
  if(!id) return;
  fetch('/api/queue/cancel?id='+encodeURIComponent(id), {method:'POST'})
    .then(r=>r.json().catch(()=>({})))
    .then(d=>{ if(!d.ok) showToast('za późno — w drodze do tmux', 'err'); });
});

async function processQueue(){
  if(isProcessing) return;
  isProcessing = true;
  while(messageQueue.length){
    const msg = messageQueue.shift();
    updateQueueIndicator();
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 15000);
    try{
      const body = { text: msg.text, files: msg.files, pendingId: msg.pendingId };
      const r = await fetch('/api/send', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body), signal: ctrl.signal});
      const d = await r.json().catch(()=>({}));
      if(r.ok){
        const pe = findPendingByPid(msg._pendingId);
        if(pe && d.id){ pe._queueId = d.id; }
        if(d.queued) showToast('w kolejce', 'ok');
        else showToast('wysłano'+(d.files?(' ('+d.files+' plik'+(d.files===1?'':(d.files<5?'i':'ów'))+')'):''), 'ok');
      } else {
        const pe = findPendingByPid(msg._pendingId);
        if(pe){ pe._error = d.error || ('HTTP '+r.status); state.lastRenderedMaxIndex = null; if(state.view==='latest') renderLatest({mode:'newer'}); }
        showToast('błąd: ' + (d.error || r.status), 'err');
      }
    }catch(e){
      const msg2 = e.name === 'AbortError' ? 'timeout — sprawdź tmux' : ('błąd: ' + e.message);
      const pe = findPendingByPid(msg._pendingId);
      if(pe){ pe._error = msg2; state.lastRenderedMaxIndex = null; if(state.view==='latest') renderLatest({mode:'newer'}); }
      showToast(msg2, 'err');
    }finally{
      clearTimeout(timeoutId);
    }
  }
  isProcessing = false;
  updateQueueIndicator();
}

window.addEventListener('beforeunload', (e) => {
  if(messageQueue.length > 0 || isProcessing){
    e.preventDefault();
    e.returnValue = '';
  }
});

sendForm.addEventListener('submit',(e)=>{ e.preventDefault(); enqueueMessage(); });
sendText.addEventListener('keydown',(e)=>{
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); enqueueMessage(); }
});
sendText.addEventListener('input',()=>{
  sendText.style.height='auto';
  const h=Math.min(sendText.scrollHeight,140);
  sendText.style.height=h+'px';
  sendText.style.overflowY = sendText.scrollHeight > 140 ? 'auto' : 'hidden';
});

function setSendFormVisible(v){
  sendForm.style.display = v ? 'flex' : 'none';
}
const filterWrap = document.getElementById('filter-wrap');

let state = { view:'latest', filter:'all', query:'', session:null, sessionMeta:null, focusTs:null, events:null, sessions:null, commands:null, feed:null, pollTimer:null, scrollObs:null, sse:null, polling:false, lastRenderedMaxIndex:null };
const MAX_FEED_EVENTS = 2000;

function stopLatestLoops(){
  if(state.pollTimer){ clearInterval(state.pollTimer); state.pollTimer=null; }
  if(state.scrollObs){ state.scrollObs.disconnect(); state.scrollObs=null; }
  if(state.sse){ try{ state.sse.close(); }catch{} state.sse=null; }
  stopPanePoll();
}

const PANE_POLL_KEY = 'cpa-panel-pane-on';
const PANE_POLL_MS = 1500;
let panePollTimer = null;
let panePollPending = false;
async function pollPaneOnce(){
  if(panePollPending) return;
  if(panePreview.style.display === 'none') return;
  panePollPending = true;
  try {
    const r = await fetch('/api/pane');
    const d = await r.json().catch(()=>({}));
    if(r.ok && d && d.ok){
      panePreview.classList.remove('err');
      panePreviewPre.textContent = (d.text || '').replace(/\\s+$/, '');
    } else {
      panePreview.classList.add('err');
      panePreviewPre.textContent = 'błąd: ' + ((d && d.error) || ('HTTP '+r.status));
    }
  } catch(e) {
    panePreview.classList.add('err');
    panePreviewPre.textContent = 'błąd: ' + e.message;
  } finally {
    panePollPending = false;
  }
}
function startPanePoll(){
  if(panePreview.style.display === 'none') return;
  if(state.view !== 'latest') return;
  pollPaneOnce();
  if(panePollTimer) clearInterval(panePollTimer);
  panePollTimer = setInterval(()=>{ if(state.view==='latest') pollPaneOnce(); }, PANE_POLL_MS);
}
function stopPanePoll(){
  if(panePollTimer){ clearInterval(panePollTimer); panePollTimer=null; }
}
function panePrefOn(){
  try{ return localStorage.getItem(PANE_POLL_KEY) === '1'; }catch{ return false; }
}
function setPanePref(on){
  try{ on ? localStorage.setItem(PANE_POLL_KEY,'1') : localStorage.removeItem(PANE_POLL_KEY); }catch{}
}
function applyPaneVisibility(){
  const onLatest = state.view === 'latest';
  const prefOn = panePrefOn();
  paneToggle.style.display = onLatest ? '' : 'none';
  paneToggle.classList.toggle('active', prefOn);
  if(onLatest && prefOn){
    panePreview.style.display = '';
    startPanePoll();
  } else {
    panePreview.style.display = 'none';
    stopPanePoll();
  }
}
paneToggle.addEventListener('click', ()=>{
  setPanePref(!panePrefOn());
  applyPaneVisibility();
});

function setViewTab(view){
  [...tabsWrap.querySelectorAll('.tab')].forEach(t=>{
    t.classList.toggle('active', t.dataset.view===view);
  });
}

function fmtDate(ts){
  if(!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(y.getDate()-1);
  const yest = d.toDateString() === y.toDateString();
  const time = d.toLocaleTimeString('pl',{hour:'2-digit',minute:'2-digit'});
  if(sameDay) return 'dziś '+time;
  if(yest) return 'wczoraj '+time;
  return d.toLocaleDateString('pl',{day:'2-digit',month:'short'})+' '+time;
}
function fmtDuration(a,b){
  if(!a||!b) return '';
  const s = Math.max(0,(b-a)/1000);
  if(s<60) return Math.round(s)+'s';
  if(s<3600) return Math.round(s/60)+'m';
  return Math.round(s/3600*10)/10+'h';
}
function esc(s){ return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function buildSearchText(e){
  const parts=[];
  if(e.text) parts.push(e.text);
  if(e.name) parts.push(e.name);
  if(e.input!=null){
    if(typeof e.input==='string') parts.push(e.input);
    else parts.push(JSON.stringify(e.input));
  }
  return parts.join(' ').toLowerCase();
}
function searchMatch(e,q){
  if(e._searchText==null) e._searchText=buildSearchText(e);
  return e._searchText.includes(q);
}

function renderSessions(){
  state.view='sessions';
  titleEl.textContent='Claude panel';
  backEl.style.display='none';
  tabsWrap.style.display='';
  filterWrap.style.display='none';
  setSendFormVisible(false);
  setInfoButtonVisible(false);
  applyPaneVisibility();
  setStatus('idle');
  setViewTab('sessions');
  qEl.placeholder='szukaj w sesjach…';
  qEl.value=state.query||'';
  const q=(state.query||'').toLowerCase();
  const list=(state.sessions||[]).filter(s=>!q||(s.firstUser||'').toLowerCase().includes(q)||s.id.includes(q));
  counterEl.textContent=list.length+'';
  if(!list.length){ main.innerHTML='<div class="empty">brak sesji</div>'; return; }
  main.innerHTML=list.map(s=>{
    const dur=fmtDuration(s.firstTs,s.lastTs);
    return '<a class="session" href="#/s/'+encodeURIComponent(s.project)+'/'+encodeURIComponent(s.id)+'">'
      +'<div class="title">'+(esc(s.firstUser)||'<span style="color:var(--muted)">(bez pierwszej wiadomości)</span>')+'</div>'
      +'<div class="meta">'
      +'<span>'+fmtDate(s.lastTs)+'</span>'
      +(dur?'<span class="tag">'+dur+'</span>':'')
      +'<span class="tag">'+s.userCount+' user</span>'
      +'<span class="tag">'+s.asstCount+' claude</span>'
      +'<span class="tag">'+s.toolCount+' tool</span>'
      +(s.gitBranch?'<span class="tag">'+esc(s.gitBranch)+'</span>':'')
      +'</div></a>';
  }).join('');
}

function renderLatest(opts){
  state.view='latest';
  titleEl.textContent='Najnowsze';
  backEl.style.display='none';
  tabsWrap.style.display='';
  filterWrap.style.display='none';
  setSendFormVisible(true);
  setInfoButtonVisible(true);
  applyPaneVisibility();
  setViewTab('latest');
  qEl.placeholder='szukaj w najnowszych…';
  qEl.value=state.query||'';
  const f=state.feed;
  setStatus(f ? f.status : 'idle');
  if(!f){ main.innerHTML='<div class="empty">brak sesji</div>'; state.lastRenderedMaxIndex=null; return; }
  const q=(state.query||'').toLowerCase();
  let evs=f.events;
  if(q) evs=evs.filter(e=>searchMatch(e,q));
  counterEl.textContent=f.events.length+'/'+f.totalEvents;
  const title=(f.meta&&f.meta.firstUser)?f.meta.firstUser:f.sessionId;
  const header='<a class="session" href="#/s/'+encodeURIComponent(f.project)+'/'+encodeURIComponent(f.sessionId)+'"><div class="title">'+esc(title)+'</div><div class="meta"><span>otwórz całą sesję →</span>'+(f.meta?'<span class="tag">'+f.meta.userCount+' user</span><span class="tag">'+f.meta.asstCount+' claude</span><span class="tag">'+f.meta.toolCount+' tool</span>':'')+'<span class="tag" id="live-dot">● live</span></div></a>';
  infoPanel.innerHTML=header;
  const rendered=evs.map(renderEvent).join('');
  const topSentinel=f.noMoreOlder
    ? '<div class="empty" style="padding:20px 10px">początek sesji</div>'
    : '<div id="latest-sentinel" class="empty" style="padding:24px 10px">ładowanie starszych…</div>';

  const mode=opts&&opts.mode;
  const prevH=main.scrollHeight;
  const prevY=main.scrollTop;
  const viewH=main.clientHeight;
  const wasNearBottom = (prevY + viewH) >= (prevH - 60);
  const wasNearTop = prevY < 100;
  const maxIdxNow = evs.length ? evs[evs.length-1]._i : null;

  // Incremental append for 'newer' mode (preserves selection/scroll/inputs).
  // Skip when pending optimistic events are present — their position and
  // stuck-after-30s flag need a full re-render to stay correct.
  const hasPendingNow = evs.some(e => e._pending);
  if(mode==='newer' && !q && state.lastRenderedMaxIndex!=null && main.querySelector('.event') && !hasPendingNow){
    const fresh = evs.filter(e => e._i > state.lastRenderedMaxIndex);
    if(fresh.length){
      main.insertAdjacentHTML('beforeend', fresh.map(renderEvent).join(''));
      state.lastRenderedMaxIndex = fresh[fresh.length-1]._i;
      if(wasNearBottom) main.scrollTop = main.scrollHeight;
    }
    return;
  }

  main.innerHTML=topSentinel+rendered;
  state.lastRenderedMaxIndex = maxIdxNow;

  const newH=main.scrollHeight;
  if(mode==='initial'){
    main.scrollTop=newH;
  } else if(mode==='newer'){
    if(wasNearBottom) main.scrollTop=newH;
  } else if(mode==='older'){
    if(!wasNearTop) main.scrollTop=prevY+(newH-prevH);
  }
  attachScrollObserver();
}

function renderCommands(){
  state.view='commands';
  titleEl.textContent='Komendy';
  backEl.style.display='none';
  tabsWrap.style.display='';
  filterWrap.style.display='none';
  setSendFormVisible(false);
  setInfoButtonVisible(false);
  applyPaneVisibility();
  setStatus('idle');
  setViewTab('commands');
  qEl.placeholder='szukaj w komendach…';
  qEl.value=state.query||'';
  const q=(state.query||'').toLowerCase();
  const list=(state.commands||[]).filter(c=>!q||(c.display||'').toLowerCase().includes(q));
  counterEl.textContent=list.length+'';
  if(!list.length){ main.innerHTML='<div class="empty">brak komend</div>'; return; }
  const byId={};
  for(const s of (state.sessions||[])) byId[s.id]=s;
  main.innerHTML=list.map(c=>{
    const sess=byId[c.sessionId];
    const when='<div class="when"><span>'+fmtDate(c.timestamp)+'</span>'+(c.project?'<span class="sep">·</span><span>'+esc(c.project)+'</span>':'')+(sess?'<span class="sep">·</span><span style="color:var(--accent)">otwórz →</span>':'')+'</div>';
    const body='<div class="t">'+esc(c.display)+'</div>';
    if(sess){
      const href='#/s/'+encodeURIComponent(sess.project)+'/'+encodeURIComponent(c.sessionId)+'/'+c.timestamp;
      return '<a class="cmd" href="'+href+'">'+when+body+'</a>';
    }
    return '<div class="cmd nolink">'+when+body+'</div>';
  }).join('');
}

function renderSession(){
  state.view='session';
  titleEl.textContent=(state.sessionMeta&&state.sessionMeta.firstUser)?state.sessionMeta.firstUser.slice(0,40):state.session.id.slice(0,8);
  backEl.style.display='';
  backEl.onclick=(e)=>{e.preventDefault();location.hash='';};
  tabsWrap.style.display='none';
  filterWrap.style.display='';
  setSendFormVisible(false);
  setInfoButtonVisible(false);
  applyPaneVisibility();
  setStatus('idle');
  qEl.placeholder='szukaj w sesji…';
  qEl.value=state.query||'';
  const filterSel=document.getElementById('filter-select');
  if(filterSel) filterSel.value=state.filter;
  const q=(state.query||'').toLowerCase();
  let evs=state.events||[];
  if(state.filter!=='all') evs=evs.filter(e=>e.kind===state.filter);
  if(q) evs=evs.filter(e=>searchMatch(e,q));
  counterEl.textContent=evs.length+'';
  if(!evs.length){ main.innerHTML='<div class="empty">brak wyników</div>'; return; }
  main.innerHTML=evs.map(renderEvent).join('');
}

function renderMarkdown(text){
  if(!text) return '';
  const codeBlocks=[]; const inlineCodes=[];
  let s=String(text);
  s=s.replace(/\`\`\`([a-zA-Z0-9_+\\-.]*)\\n?([\\s\\S]*?)\`\`\`/g,function(_,lang,code){
    codeBlocks.push({lang:lang,code:code.replace(/\\n$/,'')});
    return ' CODE'+(codeBlocks.length-1)+' ';
  });
  s=s.replace(/\`([^\`\\n]+)\`/g,function(_,code){
    inlineCodes.push(code);
    return ' IC'+(inlineCodes.length-1)+' ';
  });
  s=esc(s);
  const lines=s.split('\\n');
  const out=[];
  let listType=null; let inQuote=false; let para=[]; let tableRows=null; let tableAligns=null;
  const flushPara=function(){ if(para.length){ out.push('<p>'+para.join(' ')+'</p>'); para=[]; } };
  const flushList=function(){ if(listType){ out.push('</'+listType+'>'); listType=null; } };
  const flushQuote=function(){ if(inQuote){ out.push('</blockquote>'); inQuote=false; } };
  const isPipeLine=function(l){ return /^\\s*\\|.+\\|\\s*$/.test(l); };
  const isSepLine=function(l){ return /^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$/.test(l) || /^\\s*\\|\\s*:?-{3,}:?\\s*\\|\\s*$/.test(l); };
  const splitCells=function(l){ return l.replace(/^\\s*\\|/, '').replace(/\\|\\s*$/, '').split('|').map(function(c){ return c.trim(); }); };
  const flushTable=function(){
    if(!tableRows||!tableRows.length){ tableRows=null; tableAligns=null; return; }
    const aligns=tableAligns||[];
    let h='<table class="md-table">';
    if(tableRows[0]){
      h+='<thead><tr>';
      for(let i=0;i<tableRows[0].length;i++){
        const a=aligns[i];
        h+='<th'+(a?' style="text-align:'+a+'"':'')+'>'+(tableRows[0][i]||'')+'</th>';
      }
      h+='</tr></thead>';
    }
    if(tableRows.length>1){
      h+='<tbody>';
      const cols=tableRows[0]?tableRows[0].length:0;
      for(let r=1;r<tableRows.length;r++){
        h+='<tr>';
        const row=tableRows[r]||[];
        for(let i=0;i<Math.max(cols,row.length);i++){
          const a=aligns[i];
          h+='<td'+(a?' style="text-align:'+a+'"':'')+'>'+(row[i]||'')+'</td>';
        }
        h+='</tr>';
      }
      h+='</tbody>';
    }
    h+='</table>';
    out.push(h);
    tableRows=null; tableAligns=null;
  };
  for(let li=0;li<lines.length;li++){
    const line=lines[li];
    let m;
    // Table: header row + separator row → start/continue table.
    if(tableRows===null){
      if(isPipeLine(line) && li+1<lines.length && isSepLine(lines[li+1])){
        flushPara(); flushList(); flushQuote();
        tableRows=[splitCells(line)];
        tableAligns=splitCells(lines[li+1]).map(function(c){
          const lr=c.startsWith(':');
          const rr=c.endsWith(':');
          return lr&&rr?'center':rr?'right':lr?'left':'';
        });
        li++;
        continue;
      }
    } else {
      if(isPipeLine(line)){ tableRows.push(splitCells(line)); continue; }
      flushTable();
    }
    if((m=line.match(/^(#{1,3})\\s+(.+?)\\s*$/))){
      flushPara(); flushList(); flushQuote();
      const lvl=m[1].length;
      out.push('<h'+lvl+'>'+m[2]+'</h'+lvl+'>'); continue;
    }
    if(/^-{3,}\\s*$/.test(line) || /^\\*{3,}\\s*$/.test(line)){
      flushPara(); flushList(); flushQuote(); out.push('<hr>'); continue;
    }
    if((m=line.match(/^\\s*[-*]\\s+(.+)$/))){
      flushPara(); flushQuote();
      if(listType!=='ul'){ flushList(); out.push('<ul>'); listType='ul'; }
      out.push('<li>'+m[1]+'</li>'); continue;
    }
    if((m=line.match(/^\\s*\\d+\\.\\s+(.+)$/))){
      flushPara(); flushQuote();
      if(listType!=='ol'){ flushList(); out.push('<ol>'); listType='ol'; }
      out.push('<li>'+m[1]+'</li>'); continue;
    }
    if((m=line.match(/^&gt;\\s?(.*)$/))){
      flushPara(); flushList();
      if(!inQuote){ out.push('<blockquote>'); inQuote=true; }
      out.push('<p>'+m[1]+'</p>'); continue;
    }
    if(/^\\s*$/.test(line)){ flushPara(); flushList(); flushQuote(); continue; }
    if(/^ CODE\\d+ \\s*$/.test(line)){
      flushPara(); flushList(); flushQuote();
      out.push(line); continue;
    }
    flushList(); flushQuote();
    para.push(line);
  }
  flushPara(); flushList(); flushQuote(); flushTable();
  let html=out.join('');
  html=html.replace(/\\*\\*([^*\\n]+?)\\*\\*/g,'<strong>$1</strong>');
  html=html.replace(/(^|[^*\\w])\\*([^*\\n]+?)\\*(?!\\*)/g,'$1<em>$2</em>');
  html=html.replace(/(^|[^_\\w])_([^_\\n]+?)_(?!_)/g,'$1<em>$2</em>');
  html=html.replace(/\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)/g,function(_,t,u){
    const safe=/^(https?:|\\/|#|mailto:)/i.test(u)?u:'#';
    return '<a href="'+safe+'" target="_blank" rel="noopener">'+t+'</a>';
  });
  html=html.replace(/ IC(\\d+) /g,function(_,i){ return '<code>'+esc(inlineCodes[+i])+'</code>'; });
  html=html.replace(/ CODE(\\d+) /g,function(_,i){
    const cb=codeBlocks[+i];
    return '<pre><code'+(cb.lang?' data-lang="'+esc(cb.lang)+'"':'')+'>'+esc(cb.code)+'</code></pre>';
  });
  return html;
}

function computeLineDiff(a,b){
  const m=a.length,n=b.length;
  if(m===0) return b.map(function(l){ return ['add',l]; });
  if(n===0) return a.map(function(l){ return ['del',l]; });
  const lcs=new Array(m+1);
  for(let i=0;i<=m;i++) lcs[i]=new Int32Array(n+1);
  for(let i=m-1;i>=0;i--){
    for(let j=n-1;j>=0;j--){
      lcs[i][j]=a[i]===b[j]?lcs[i+1][j+1]+1:Math.max(lcs[i+1][j],lcs[i][j+1]);
    }
  }
  const out=[]; let i=0,j=0;
  while(i<m&&j<n){
    if(a[i]===b[j]){ out.push(['eq',a[i]]); i++; j++; }
    else if(lcs[i+1][j]>=lcs[i][j+1]){ out.push(['del',a[i]]); i++; }
    else { out.push(['add',b[j]]); j++; }
  }
  while(i<m){ out.push(['del',a[i]]); i++; }
  while(j<n){ out.push(['add',b[j]]); j++; }
  return out;
}

function renderEditDiff(input){
  if(!input || typeof input.old_string!=='string' || typeof input.new_string!=='string') return '';
  const a=input.old_string.split('\\n');
  const b=input.new_string.split('\\n');
  const diff=computeLineDiff(a,b);
  if(diff.length>200){
    const head=diff.slice(0,100).map(renderDiffLine).join('');
    const tail=diff.slice(-50).map(renderDiffLine).join('');
    return '<div class="diff">'+head+'<div class="diff-skip">… '+(diff.length-150)+' linii pominięte …</div>'+tail+'</div>';
  }
  return '<div class="diff">'+diff.map(renderDiffLine).join('')+'</div>';
}
function renderDiffLine(d){
  const cls=d[0]==='add'?'diff-add':d[0]==='del'?'diff-del':'diff-eq';
  const sign=d[0]==='add'?'+':d[0]==='del'?'-':' ';
  return '<div class="'+cls+'">'+sign+' '+esc(d[1]||'')+'</div>';
}

function summariseInput(name, input){
  if(!input) return '';
  if(name==='Bash') return input.command||'';
  if(name==='Read'||name==='Edit'||name==='Write') return input.file_path||'';
  if(name==='Grep') return (input.pattern||'')+(input.path?' · '+input.path:'');
  if(name==='Glob') return input.pattern||'';
  if(name==='WebFetch') return input.url||'';
  if(name==='Agent') return input.description||input.subagent_type||'';
  if(name==='TodoWrite'||name==='TaskCreate'||name==='TaskUpdate') return (input.description||input.status||'');
  if(name==='Skill') return input.skill||'';
  return '';
}

function renderEvent(e){
  const time=e.ts?fmtDate(Date.parse(e.ts)):'';
  const label=({user:'user',assistant:'claude',tool_use:'tool',tool_result:'result',system:'system',thinking:'thinking'}[e.kind])||e.kind;
  // X button on pending: server-cancel if cancellable, local-dismiss if errored/stuck.
  let xBtn = '';
  if(e._pending){
    const errored = !!e._error;
    const stuck = !errored && (Date.now() - (e._pendingAt||0)) > 30000;
    const sentOrSending = e._serverState === 'sending' || e._serverState === 'sent';
    if(errored || stuck){
      xBtn = '<button class="pending-cancel" data-local-pid="'+esc(e._pendingId||'')+'" title="zamknij" aria-label="zamknij">×</button>';
    } else if(e._queueId && !sentOrSending){
      xBtn = '<button class="pending-cancel" data-cancel-id="'+esc(e._queueId)+'" title="anuluj" aria-label="anuluj">×</button>';
    }
  }
  const cancelBtn = xBtn;
  const tsHtml = time ? '<span style="margin-left:auto">'+time+'</span>' : (cancelBtn ? '<span style="flex:1"></span>' : '');
  const head='<div class="h"><span class="k">'+label+'</span>'+(e.kind==='tool_use'?'<span class="toolname">'+esc(e.name)+'</span>':'')+tsHtml+cancelBtn+'</div>';
  let body='';
  if(e.kind==='tool_use'){
    const summary=summariseInput(e.name,e.input);
    let extra='';
    if(e.name==='Edit'){
      extra=renderEditDiff(e.input);
    } else if(e.name==='MultiEdit' && e.input && Array.isArray(e.input.edits)){
      extra=e.input.edits.map(ed=>renderEditDiff(ed)).join('');
    }
    body=(summary?'<pre>'+esc(summary)+'</pre>':'')
       +extra
       +'<details class="more"><summary>pełny input</summary><pre>'+esc(JSON.stringify(e.input,null,2))+'</pre></details>';
  } else if(e.kind==='tool_result'){
    const t=e.text||'';
    if(t.length>1200){
      body='<div class="long-wrap collapsed"><pre>'+esc(t)+'</pre><button type="button" class="long-toggle" data-len="'+t.length+'"></button></div>';
    } else {
      body='<pre>'+esc(t)+'</pre>';
    }
  } else {
    const t=e.text||'';
    const useMd=(e.kind==='assistant'||e.kind==='thinking');
    const cls='body'+(useMd?' md':'');
    const rendered=useMd?renderMarkdown(t):esc(t);
    if(t.length>1500){
      body='<div class="long-wrap collapsed"><div class="'+cls+'">'+rendered+'</div><button type="button" class="long-toggle"></button></div>';
    } else {
      body='<div class="'+cls+'">'+rendered+'</div>';
    }
  }
  let cls='event '+e.kind+(e.isError?' err':'');
  if(e._pending){
    cls += ' pending';
    if(e._serverState === 'sending') cls += ' p-sending';
    else if(e._serverState === 'sent') cls += ' p-sent';
    if(e._error) cls += ' errored';
    else if((Date.now() - (e._pendingAt||0)) > 30000) cls += ' stuck';
  }
  const tsAttr=e.ts?' data-ts="'+Date.parse(e.ts)+'"':'';
  const kindAttr=' data-kind="'+e.kind+'"';
  const idAttr=e._pendingId?' data-pid="'+e._pendingId+'"':'';
  return '<div class="'+cls+'"'+tsAttr+kindAttr+idAttr+'>'+head+body+'</div>';
}

function focusEvent(){
  if(!state.focusTs) return;
  const nodes=[...main.querySelectorAll('.event.user[data-ts]')];
  if(!nodes.length) return;
  let best=null, bestDiff=Infinity;
  for(const n of nodes){
    const t=Number(n.dataset.ts);
    const diff=Math.abs(t-state.focusTs);
    if(diff<bestDiff){ bestDiff=diff; best=n; }
  }
  if(best){
    if(bestDiff < 120000) best.classList.add('focus');
    best.scrollIntoView({block:'start',behavior:'smooth'});
  } else {
    main.scrollTop=0;
  }
}

async function loadSessions(){
  if(state.sessions) return;
  const r=await fetch('/api/sessions');
  state.sessions=await r.json();
}
async function loadCommands(){
  const tasks=[];
  if(!state.commands) tasks.push(fetch('/api/commands?limit=500').then(r=>r.json()).then(d=>state.commands=d));
  if(!state.sessions) tasks.push(fetch('/api/sessions').then(r=>r.json()).then(d=>state.sessions=d));
  if(tasks.length) await Promise.all(tasks);
}
async function initLatest(){
  const r=await fetch('/api/latest?limit=50');
  const d=await r.json();
  if(d.empty){ state.feed=null; return; }
  const idx=d.events.map(e=>e._i);
  state.feed={
    sessionId:d.sessionId, project:d.project, totalEvents:d.totalEvents, meta:d.meta,
    events:d.events,
    minIndex:idx.length?Math.min.apply(null,idx):d.totalEvents,
    maxIndex:idx.length?Math.max.apply(null,idx):-1,
    loading:false,
    noMoreOlder:idx.length?Math.min.apply(null,idx)===0:true,
    status:d.status||'idle',
  };
}
async function loadOlder(){
  const f=state.feed;
  if(!f||f.loading||f.noMoreOlder) return;
  f.loading=true;
  try{
    const d=await fetch('/api/latest?before='+f.minIndex+'&limit=50').then(r=>r.json());
    if(d.empty) return;
    if(d.sessionId!==f.sessionId){ await initLatest(); renderLatest({mode:'initial'}); return; }
    const fresh=d.events.filter(e=>e._i<f.minIndex);
    if(!fresh.length){ f.noMoreOlder=true; }
    else{
      f.events=fresh.concat(f.events);
      const mn=Math.min.apply(null,fresh.map(e=>e._i));
      f.minIndex=mn;
      if(mn===0) f.noMoreOlder=true;
    }
    f.totalEvents=d.totalEvents;
  }catch(e){}
  finally{ f.loading=false; }
  renderLatest({mode:'older'});
}
function normForMatch(s){ return String(s||'').replace(/\\s+/g,' ').trim(); }
function looksLikeUploadPayload(real){
  // Server appends "[image: <path>]" for images and bare path for other files.
  // Both contain the uploads dir. Used to match files-only pending.
  return /\\[image:|\\/uploads\\//.test(real);
}
function reapPending(f, fresh){
  // For each fresh user event, drop the oldest matching pending in f.events.
  // Match: real text equals or starts with pending text (server may append
  // "[image: …]" or a bare path). Pending entries sent with only files have
  // a placeholder text like "[1 plik]" — match those by detecting the upload
  // payload signature in the real event instead.
  let removed = 0;
  for(const ev of fresh){
    if(ev.kind !== 'user') continue;
    const real = normForMatch(ev.text);
    if(!real) continue;
    const filesOnlyReal = looksLikeUploadPayload(real) && !real.replace(/\\[image:[^\\]]*\\]/g,'').replace(/\\S*\\/uploads\\/\\S*/g,'').trim();
    for(let i=0; i<f.events.length; i++){
      const p = f.events[i];
      if(!p._pending) continue;
      if(p._error) continue; // errored pending must stay until user dismisses
      if(p._pendingHasFiles && !p._pendingHasText && filesOnlyReal){
        f.events.splice(i,1); removed++; break;
      }
      const pn = normForMatch(p._pendingHasText ? p.text : '');
      if(!pn) continue;
      if(real === pn || real.startsWith(pn) || real.startsWith(pn + ' ')){
        f.events.splice(i,1); removed++; break;
      }
    }
  }
  return removed;
}

async function pollLatest(){
  if(state.view!=='latest') return;
  if(state.polling) return;
  if(!state.feed){ state.polling=true; try{ await initLatest(); if(state.view==='latest') renderLatest({mode:'initial'}); } finally{ state.polling=false; } return; }
  const f=state.feed;
  if(f.loading) return;
  state.polling=true;
  try{
    const d=await fetch('/api/latest?after='+f.maxIndex).then(r=>r.json());
    if(state.view!=='latest') return;
    if(d.empty) return;
    if(d.sessionId!==f.sessionId){ await initLatest(); if(state.view==='latest') renderLatest({mode:'initial'}); return; }
    f.totalEvents=d.totalEvents;
    f.status=d.status||'idle';
    setStatus(f.status);
    const fresh=d.events.filter(e=>e._i>f.maxIndex);
    if(fresh.length){
      const reaped = reapPending(f, fresh);
      // Pending removal breaks the prefix-unchanged assumption of incremental render.
      if(reaped) state.lastRenderedMaxIndex=null;
      // Insert fresh server events before any remaining pending (so pending stay at the bottom).
      const pending = f.events.filter(e=>e._pending);
      const nonPending = f.events.filter(e=>!e._pending);
      f.events = nonPending.concat(fresh).concat(pending);
      if(pending.length) state.lastRenderedMaxIndex=null; // pending mixed in: prefix may have shifted
      if(f.events.length>MAX_FEED_EVENTS){
        f.events=f.events.slice(-MAX_FEED_EVENTS);
        state.lastRenderedMaxIndex=null;
      }
      f.maxIndex=Math.max.apply(null,fresh.map(e=>e._i));
      renderLatest({mode:'newer'});
    } else if(f.events.some(e=>e._pending && (Date.now()-(e._pendingAt||0))>5000)){
      // No new server events but stale pending exist — re-render to refresh stuck markers.
      renderLatest({mode:'newer'});
    }
  }catch(e){}
  finally{ state.polling=false; }
}
function attachScrollObserver(){
  if(state.scrollObs){ state.scrollObs.disconnect(); state.scrollObs=null; }
  const sentinel=document.getElementById('latest-sentinel');
  if(sentinel){
    state.scrollObs=new IntersectionObserver((ents)=>{ if(ents[0].isIntersecting) loadOlder(); },{root:main,rootMargin:'300px'});
    state.scrollObs.observe(sentinel);
  }
}
function startLatestLoops(){
  if(state.sse) return; // idempotent — don't restart on every render
  try{
    state.sse=new EventSource('/api/stream');
    state.sse.onmessage=(e)=>{
      try{
        const d=JSON.parse(e.data);
        if(d.type==='hello'){
          if(window.__serverStartup && window.__serverStartup !== d.startup){
            location.reload();
            return;
          }
          window.__serverStartup = d.startup;
        }
        if(d.type==='tick') pollLatest();
        if(d.type==='queue') handleQueueEvent(d);
        if(d.type==='interrupted') flipToIdle();
      }catch{}
    };
  }catch{}
  if(!state.pollTimer) state.pollTimer=setInterval(pollLatest,15000);
}
async function loadSession(project,id){
  const r=await fetch('/api/session?project='+encodeURIComponent(project)+'&id='+encodeURIComponent(id));
  const data=await r.json();
  state.session={project,id};
  state.events=data.events;
  state.sessionMeta=data.meta;
}

async function route(){
  const h=location.hash.slice(1);
  state.query='';
  searchToggle.classList.remove('has-query');
  // Leaving latest view: stop live loops. Leaving session view: drop stale data.
  const goingToLatest = !h || h==='/';
  if(!goingToLatest) stopLatestLoops();
  if(!h.startsWith('/s/')){
    state.session=null; state.events=null; state.sessionMeta=null; state.focusTs=null;
  }
  if(h.startsWith('/s/')){
    const parts=h.slice(3).split('/');
    const project=decodeURIComponent(parts[0]||'');
    const id=decodeURIComponent(parts[1]||'');
    if(!state.session || state.session.id!==id) state.filter='all';
    state.focusTs = parts[2] ? Number(parts[2]) : null;
    main.innerHTML='<div class="empty">ładowanie…</div>';
    try{ await loadSession(project,id); renderSession(); focusEvent(); }
    catch(e){ main.innerHTML='<div class="empty">błąd: '+esc(e.message)+'</div>'; }
  } else if(h==='/commands'){
    main.innerHTML='<div class="empty">ładowanie…</div>';
    state.commands=null; // refetch on each visit
    await loadCommands();
    renderCommands();
  } else if(h==='/sessions'){
    main.innerHTML='<div class="empty">ładowanie…</div>';
    state.sessions=null; // refetch on each visit
    await loadSessions();
    renderSessions();
  } else {
    main.innerHTML='<div class="empty">ładowanie…</div>';
    state.lastRenderedMaxIndex=null;
    await initLatest();
    renderLatest({mode:'initial'});
    startLatestLoops();
  }
}

tabsWrap.addEventListener('click',(e)=>{
  const t=e.target.closest('.tab'); if(!t) return;
  const v=t.dataset.view;
  if(!v) return;
  if(v==='commands') location.hash='/commands';
  else if(v==='sessions') location.hash='/sessions';
  else location.hash='';
});

const searchWrap = document.getElementById('search-wrap');
const searchToggle = document.getElementById('search-toggle');
function setSearchOpen(open){
  searchWrap.style.display = open ? '' : 'none';
  searchToggle.classList.toggle('active', open);
  if(open) setTimeout(()=>qEl.focus(), 30);
}
function rerenderCurrent(){
  if(state.view==='sessions') renderSessions();
  else if(state.view==='commands') renderCommands();
  else if(state.view==='latest') renderLatest();
  else if(state.view==='session') renderSession();
}
searchToggle.addEventListener('click',(e)=>{
  e.preventDefault();
  const open = searchWrap.style.display !== 'none';
  if(open){
    setSearchOpen(false);
    if(state.query){
      state.query='';
      qEl.value='';
      searchToggle.classList.remove('has-query');
      rerenderCurrent();
    }
  } else {
    setSearchOpen(true);
  }
});
qEl.addEventListener('keydown',(e)=>{
  if(e.key==='Escape'){ e.preventDefault(); searchToggle.click(); }
});
document.getElementById('filter-select').addEventListener('change',(e)=>{
  state.filter=e.target.value;
  renderSession();
});
let _qDebounce;
qEl.addEventListener('input',()=>{
  clearTimeout(_qDebounce);
  _qDebounce=setTimeout(()=>{
    state.query=qEl.value;
    searchToggle.classList.toggle('has-query', !!state.query);
    rerenderCurrent();
  }, 180);
});
window.addEventListener('hashchange',route);
route();

function pctClass(p){ return p>=80 ? 'crit' : p>=50 ? 'warn' : ''; }
function fmtReset(iso, withDate){
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return '';
  const time = d.toLocaleTimeString('pl',{hour:'2-digit',minute:'2-digit'});
  if(withDate){
    const date = d.toLocaleDateString('pl',{day:'2-digit',month:'2-digit'});
    return 'reset '+date+' '+time;
  }
  return 'reset '+time;
}
function setUsageRow(rowId, item, withDate){
  const row = document.getElementById(rowId);
  if(!item){ row.style.display='none'; return; }
  row.style.display='';
  const pct = Math.round(Number(item.utilization)||0);
  const fill = row.querySelector('.usage-fill');
  fill.style.width = Math.min(pct,100) + '%';
  fill.className = 'usage-fill ' + pctClass(pct);
  row.querySelector('.usage-pct').textContent = pct + '%';
  row.querySelector('.usage-reset').textContent = fmtReset(item.resets_at, withDate);
}
function renderUsage(u){
  const strip = document.getElementById('usage-strip');
  if(!u){ strip.style.display='none'; return; }
  strip.style.display='';
  if(!u.ok){
    strip.classList.add('error');
    const sesRow = document.getElementById('usage-session');
    sesRow.style.display='';
    sesRow.querySelector('.usage-fill').style.width='0%';
    sesRow.querySelector('.usage-pct').textContent='—';
    const errMsg = u.error==='expired' ? 'token wygasł — uruchom claude' : u.error==='no_token' ? 'brak tokenu' : 'niedostępne';
    sesRow.querySelector('.usage-reset').textContent = errMsg;
    document.getElementById('usage-week').style.display='none';
    return;
  }
  strip.classList.remove('error');
  setUsageRow('usage-session', u.session, false);
  setUsageRow('usage-week', u.week, true);
}
const USAGE_TTL_MS = 5*60*1000;
const USAGE_KEY = 'cpa-panel-usage-v1';
function loadCachedUsage(){
  try{
    const parsed = JSON.parse(localStorage.getItem(USAGE_KEY)||'null');
    if(!parsed || !parsed.savedAt || !parsed.payload) return null;
    const age = Date.now() - parsed.savedAt;
    if(age < 0 || age >= USAGE_TTL_MS) return null;
    return parsed;
  }catch{ return null; }
}
function saveCachedUsage(payload){
  try{ localStorage.setItem(USAGE_KEY, JSON.stringify({savedAt: Date.now(), payload})); }catch{}
}
async function fetchUsage(){
  try{
    const r = await fetch('/api/usage');
    if(!r.ok) return;
    const u = await r.json();
    renderUsage(u);
    if(u && u.ok) saveCachedUsage(u);
  }catch{}
}
(function startUsage(){
  const cached = loadCachedUsage();
  if(cached){
    renderUsage(cached.payload);
    const nextIn = Math.max(0, USAGE_TTL_MS - (Date.now() - cached.savedAt));
    setTimeout(()=>{ fetchUsage(); setInterval(fetchUsage, USAGE_TTL_MS); }, nextIn);
  } else {
    fetchUsage();
    setInterval(fetchUsage, USAGE_TTL_MS);
  }
})();
`;
