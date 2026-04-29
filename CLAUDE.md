# CLAUDE.md

Repo do budowy **claude-panel** — przeglądarkowego panelu do monitorowania i sterowania sesją Claude Code działającą w sąsiednim kontenerze. Panel ma być przenośny: po dopracowaniu tutaj będzie wpinany do innych projektów (jako `claude-panel/` + dwie usługi w ich `compose.yml`).

Kod panelu = `claude-panel/`. Wszystko poza tym katalogiem (`compose.yml`, `Dockerfile`, `start.sh`, `claude/`, `claude.json`) to **harness deweloperski** — uruchamia panel i sesję Claude Code lokalnie tak, jak będą działać u końcowego użytkownika.

## Layout

```
/app
  CLAUDE.md              ← ten plik
  Dockerfile             ← obraz cpa-claude-code (node:22-slim + tmux + docker.io + claude-code CLI)
  compose.yml            ← dwie usługi: cpa-claude-code (sesja) + cpa-panel (UI)
  start.sh               ← `compose up -d` + uruchomienie tmuxa z `claude` i attach
  claude/                ← bind-mount na ~/.claude wewnątrz cpa-claude-code (sesje JSONL, OAuth)
  claude.json            ← bind-mount na ~/.claude.json (ustawienia CLI)
  claude-panel/          ← właściwy produkt — patrz §"Panel" niżej
```

## Pętla deweloperska

`./start.sh`:

1. `docker compose up -d` — buduje/uruchamia oba kontenery.
2. Czyści stary socket `/tmp/cpa-tmux/default` w `cpa-claude-code` i ustawia uprawnienia.
3. Wewnątrz `cpa-claude-code` uruchamia tmuxa na shared sockecie i odpala `claude --dangerously-skip-permissions` w sesji `cpa-tmux` (jeśli sesja już istnieje — tylko reload `tmux.conf`).
4. `docker exec -it … tmux attach` — przyklejasz się terminalem do tej samej sesji, którą widzi panel.

Panel siedzi na `http://localhost:8080`. Edycja plików w `claude-panel/src/**` → `node --watch` w kontenerze restartuje serwer (bez `docker restart`). Jeśli `fs.watch` nie złapie zmiany (znany problem bind-mountów na Linuksie) → `docker restart cpa-panel`.

`Dockerfile` w roocie buduje obraz **dla sesji Claude Code**, nie dla panelu. Panel ma własny `claude-panel/Dockerfile` (7 linii: `node:22-slim` + `tmux` + `ca-certificates`, start `node --watch server.js`).

## Dwie usługi (`compose.yml`)

**`cpa-claude-code`** — kontener, w którym żyje sesja Claude Code:
- `./` → `/app` (cały repo widoczny dla CLI; uploady z panelu lądują pod ścieżką, którą Claude widzi tu jako `/app/claude-panel/uploads/...`).
- `./claude` → `/home/node/.claude` (sesje JSONL, OAuth tokeny — czytane przez panel read-only z drugiej strony).
- `./claude.json` → `/home/node/.claude.json`.
- `/var/run/docker.sock` → `/var/run/docker.sock` + `group_add: 998` (CLI może odpalać kontenery hostowe).
- `cpa-tmux` (named volume) → `/tmp/cpa-tmux` (tu żyje socket tmuxa; tmux server biegnie w tym kontenerze).

**`cpa-panel`** — Node HTTP serwer (port 8080):
- `./claude-panel` → `/srv:ro` (kod panelu read-only; `--watch` reaguje na edycje na hoście).
- `./claude` → `/data/claude:ro` (panel czyta JSONL z transkryptami i `.credentials.json`).
- `cpa-tmux` → `/host-tmux:rw` (drugi koniec socketu — panel woła `tmux send-keys` po nim).
- `./claude-panel/uploads` → `/uploads:rw` (zapisy z `POST /api/send`).

Env panelu:
- `CLAUDE_DIR=/data/claude`, `PORT=8080`
- `TMUX_SOCKET=/host-tmux/default`, `TMUX_TARGET=cpa-tmux` (jak puste → `POST /api/send` zwraca 500)
- `UPLOADS_DIR=/uploads` (gdzie panel zapisuje)
- `UPLOADS_CLAUDE_PATH=/app/claude-panel/uploads` (jaką ścieżkę panel **wkleja w prompt** — to ścieżka, którą widzi `cpa-claude-code`)

## Panel (`claude-panel/`)

```
claude-panel/
  server.js              ← thin entrypoint: http.createServer + listen + WS upgrade dispatch (~20 linii)
  start.sh               ← entrypoint kontenera: odpala ttyd w tle + `node --watch server.js`
  Dockerfile             ← node:22-slim + tmux + ttyd binary + ca-certificates
  tmux.conf              ← config dla tmuxa odpalanego w cpa-claude-code
  uploads/               ← runtime; czyszczone na boot kontenera (nie na --watch restart)
  src/
    config.js            ← env vary + stałe (CLAUDE_DIR, PORT, MAX_UPLOAD_BYTES, MIME_TO_EXT, STARTUP_ID, …)
    files.js             ← saveFile, extFromName, sanitizeExt + mkdir uploads + wipe-on-boot
    sessions.js          ← readJSONL + rawCache, listSessions, summarize/parse/detectStatus, readHistory, stripMarkup
    sse.js               ← sseClients Set + broadcast + scheduleTick + startWatchers(fs.watch)
    tmux.js              ← runTmux/runTmuxRaw (send-keys -S socket) + sendText (literal+Enter) + sendInterrupt (Escape) + capturePane (cache 500ms)
    queue.js             ← server-side kolejka: enqueue/cancel/clearAll + worker (dispatch tylko gdy detectStatus===idle, fallback timer 2s)
    proxy.js             ← HTTP/WS proxy do ttyd na 127.0.0.1:7681 z injekcją CSS scrollbarów (route /terminal)
    usage.js             ← fetchUsage: api.anthropic.com/api/oauth/usage z OAuth tokenem z .credentials.json, cache 60s
    routes.js            ← dispatcher: GET / + /terminal + /healthz + /api/{sessions,session,latest,stream,commands,send,send-config,usage,pane,queue,queue/cancel,queue/clear,interrupt}
    ui/
      styles.js          ← CSS (template-literal)
      body.js            ← HTML body markup
      client.js          ← klient JS (~700 linii: routing, rendering, polling, attachments, SSE, pending render, pane preview)
      index.js           ← skleja `<!doctype>…<style>…</style>…<script>…</script>` w jeden string
```

`node --watch server.js` chodzi po grafie `require(...)`, więc edycje w `src/**.js` triggerują restart.

### Co panel robi

1. **Przeglądanie sesji + transkryptów.** Czyta `~/.claude/projects/<project>/<sessionId>.jsonl` (zamontowane R/O jako `/data/claude`), parsuje strumień zdarzeń JSONL i renderuje transkrypt w stylu Claude Code (user / assistant / tool_use / tool_result / thinking / system) z usuniętym markupem (`<command-name>`, `<system-reminder>`, `<local-command-*>` itd.).
2. **Live-tail aktywnej sesji.** `fs.watch` na `PROJECTS_DIR` + `HISTORY_FILE` → SSE eventy do podłączonych przeglądarek przez `/api/stream`. `detectStatus()` zwraca pigułkę "idle / thinking / working" per sesja na bazie ostatniego eventu user/assistant (zaślepione na 10 min, żeby porzucone sesje nie zostawały na "thinking" na zawsze).
3. **Subscription rate-limit usage** (paski 5h + 7d na górze panelu). `GET /api/usage` czyta `accessToken` z `${CLAUDE_DIR}/.credentials.json` i woła `https://api.anthropic.com/api/oauth/usage` z headerem `anthropic-beta: oauth-2025-04-20`. Cache server-side 60 s (deduplikuje burst z wielu kart); klient pinguje co 5 min + na load. Zwraca `{ok, session: {utilization, resets_at}, week: {utilization, resets_at}}` albo `{ok: false, error: "expired"|"no_token"|...}`. Na 401 panel pokazuje "token wygasł — uruchom claude" do czasu, aż Claude Code odświeży token w `.credentials.json` (panel re-czyta przy każdym fetchu).
4. **Wysyłanie wiadomości do sesji przez tmux.** `POST /api/send` wkleja text + opcjonalne base64 pliki przez `tmux send-keys -t <TMUX_TARGET>` na shared sockecie `/host-tmux/default`. Pliki idą do `./uploads/`, ale w prompt wklejana jest **ścieżka hostowa** (`UPLOADS_CLAUDE_PATH`, np. `/app/claude-panel/uploads/...`) — taką widzi Claude Code z drugiego kontenera. Obrazki (`image/*`) jako `[image: <path>]` (Claude auto-attach), reszta jako goła ścieżka (Claude `Read`-uje na żądanie).
5. **Wbudowany terminal** (`/terminal`). `start.sh` odpala `ttyd -p 7681 -i 127.0.0.1 -W -b /terminal tmux attach -t cpa-tmux` w tle obok node serwera. Klient panelu otwiera nową kartę pod `/terminal/`, którą serwer Node proxuje (HTTP + WS upgrade) do ttyd. `proxy.js` wstrzykuje też CSS scrollbarów do indeksowego HTML-a ttyd. Pełny tmux w przeglądarce — co widzisz w `docker exec … attach`, widzisz tutaj.

6. **Podgląd pane'a w UI** (toggle "podgląd CLI"). `GET /api/pane` woła `tmux capture-pane -p -t <target>` (cache 500ms po stronie serwera) i zwraca aktualną zawartość pane'a jako tekst. Klient pinguje co 1.5s tylko na widoku "Najnowsze" i tylko gdy toggle jest włączony — pokazuje co Claude Code TUI ma teraz na ekranie (z input boxem włącznie). Drugie źródło prawdy obok JSONL: jak wysyłka mid-thinking siedzi jeszcze w bufferze TUI, tu ją zobaczysz.

7. **Optymistyczne renderowanie własnych wysyłek + server-side kolejka + Esc.**
    - **Pending render.** Po `POST /api/send` klient od razu wstawia event do feedu z klasą `.pending` ("w kolejce…" / "wysyłam…" / "wysłane, czekam na claude…" w zależności od stanu z SSE). Gdy realny wpis pojawi się w JSONL, `reapPending` paruje po znormalizowanym tekście (prefix-matching dla payloadów ze ścieżką uploadu) i zdejmuje pending. Po 30s bez parowania pending dostaje klasę `.stuck` (czerwony "brak odpowiedzi z tmux") z lokalnym przyciskiem ×.
    - **Server-side queue (`queue.js`).** `POST /api/send` nie wysyła do tmuxa od razu — enqueue'uje w pamięci kontenera. Worker dyspatchuje **tylko gdy `detectStatus`(najnowsza sesja) === `idle`**: czeka aż Claude skończy bieżący turn, dopiero wtedy `sendText` na kolejnej pozycji + 300ms cooldown na flip statusu. Trigger workera: na enqueue, na każdym SSE ticku z fs.watch (= zmiana JSONL), oraz fallback timer 2 s. Skutek: wpisanie 3 wiadomości pod rząd podczas myślenia → 3 osobne tury Claude'a, nie jedno sklejone w bufferze TUI. Każda zmiana stanu (added/sending/sent/cancelled/error/cleared/dropped) leci jako SSE event `{type:"queue", event, queue:[...], id}`.
    - **Cancel.** `POST /api/queue/cancel?id=` zdejmuje z kolejki (zwraca 409 jak już `sending`). Klient pokazuje × na każdym pending z `_queueId`. Errored/stuck mają lokalny dismiss (`data-local-pid`).
    - **Esc.** Przycisk × w kółku w `send-form` (obok załączania plików) — `POST /api/interrupt` → `tmux send-keys Escape` → Claude przerywa bieżący turn. Disabled gdy `status==='idle'`, czerwony gdy aktywny, czerwone tło na hoverze.

### HTTP API

- `GET /` — SPA (HTML+CSS+JS inline w odpowiedzi, locale: pl).
- `GET /terminal[/...]` — proxy do ttyd (HTTP + upgrade do WS).
- `GET /api/sessions` — lista wszystkich sesji (summary, sort po mtime desc).
- `GET /api/session?id=<id>&project=<project>` — sparsowany transkrypt.
- `GET /api/latest?before=&after=&limit=` — najnowsza sesja, z paginacją.
- `GET /api/stream` — SSE; broadcast na każdą zmianę JSONL pod `PROJECTS_DIR` lub `HISTORY_FILE`. `hello` na connect (z `STARTUP_ID` — UI wykrywa restart serwera) + ping co 25 s.
- `GET /api/commands?limit=&q=` — szuka po `~/.claude/history.jsonl`.
- `POST /api/send` — body `{ text, files?: [{data, type, name}] }`. `data` to base64 data URI (lub goły base64). Limit 25 MB / request.
- `GET /api/send-config` — zwraca `TMUX_TARGET` + `TMUX_SOCKET` (bez auth — dev-only).
- `GET /api/usage` — patrz §3 wyżej.
- `GET /api/pane` — `{ ok: true, text }` z aktualnym pane'em tmuxa (cache 500ms), 500 jak `TMUX_TARGET` puste albo tmux się sypnie.
- `GET /api/queue` — `{ ok: true, queue: [{id, text, fileCount, createdAt, sending}] }` z aktualnym stanem server-side kolejki.
- `POST /api/queue/cancel?id=` — usuwa z kolejki (200 jak ok, 409 jak już `sending`).
- `POST /api/queue/clear` — drop wszystkich oprócz `sending`.
- `POST /api/interrupt` — `tmux send-keys Escape` → przerywa bieżący turn Claude'a.
- `GET /healthz` — `{ ok: true }`.

### Gotchas

- **Uploady kasują się na real container boot, nie na `--watch` restart.** Marker `/tmp/claude-panel-boot-marker` przeżywa restart procesu z `node --watch`, ale ginie na `docker compose up`. Czyli edycje kodu nie czyszczą uploadów, a recreate kontenera — czyści.
- **Raw events są cache'owane po (mtime, size)** w `rawCache` (max 64 plików). Inwalidacja automatyczna na zmianę pliku — bez ręcznego bustowania.
- **SSE `scheduleTick`** jest debounce'owany, żeby przy szybkim zapisywaniu JSONL nie generować eventu na linię.
- **Slash-command meta-entries** (`/clear` itd.) są skipowane w `detectStatus` — wpis usera bez odpowiedzi assistanta nie zostawia "thinking" na zawsze.
- **`send-keys -l`** (literal mode) — żeby specjalne znaki nie były interpretowane jako tmux key bindings. Newline'y są wycinane z `text` (tmux zjadałby je jako osobne klawisze).
- **Brak auth.** `POST /api/send` napędzi dowolną sesję tmuxa na zamontowanym sockecie. Nie eksponować portu 8080 poza localhost.
- **`claude-panel/Dockerfile` startuje `node --watch server.js`.** Edycje `server.js` auto-reload bez rebuildu — `compose.yml` montuje `./claude-panel` read-only do `/srv`.

## Wpinanie do innych projektów (cel długoterminowy)

Panel ma być self-contained — projekt docelowy musi tylko:

1. Skopiować katalog `claude-panel/` (lub dodać jako git submodule).
2. Dodać do swojego `compose.yml` usługi `cpa-claude-code` + `cpa-panel` (analogicznie do tutejszego — z bind-mountami `./` jako `/app`, `./claude` jako `/home/node/.claude` w usłudze CLI i `/data/claude:ro` w usłudze panelu, oraz named volume na socket tmuxa).
3. Mieć `~/.claude` w jakiejś formie (host albo per-project) i przekazać jako bind-mount.

Przy zmianach w panelu warto pilnować, żeby nic nie zakładało konkretnego layoutu repo gospodarza poza tym, co jest w `compose.yml`/env.
