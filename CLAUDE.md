# CLAUDE.md

Repo do budowy **claude-panel** — przeglądarkowego panelu do monitorowania i sterowania sesją Claude Code działającą w tym samym kontenerze. Cel: jeden samowystarczalny obraz Docker, który dropujesz do dowolnego projektu (jedna usługa w `compose.yml` + bind-mount kodu projektu).

Kod panelu = `claude-panel/`. Wszystko poza tym katalogiem (`compose.yml`, `start.sh`, `claude/`, `claude.json`) to **harness deweloperski** — uruchamia ten sam obraz lokalnie tak, jak będą używać go końcowi konsumenci.

## Layout

```
/app
  CLAUDE.md              ← ten plik
  compose.yml            ← jedna usługa `claude-panel` (build: ./claude-panel)
  start.sh               ← `compose up -d --build` + `docker exec -it … cpa-attach`
  claude/                ← bind-mount na ~/.claude w kontenerze (sesje JSONL, OAuth, .credentials.json)
  claude.json            ← bind-mount na ~/.claude.json (ustawienia CLI)
  claude-panel/          ← właściwy produkt — Dockerfile + kod panelu, patrz §"Panel" niżej
  .circleci/config.yml   ← release pipeline → docker.io/<user>/claude-panel (multi-arch, na tagach v*)
```

Brak root Dockerfile — pełny obraz (panel + Claude Code CLI + tmux + ttyd + docker.io) buduje się z `claude-panel/Dockerfile`.

## Pętla deweloperska

`./start.sh`:

1. `docker compose up -d --build` — buduje obraz z `claude-panel/` i odpala jedyną usługę `claude-panel`.
2. `docker exec -it claude-panel cpa-attach` — wrapper na `tmux -S /tmp/cpa-tmux/default attach -t cpa-tmux`. Przyklejasz się do tej samej sesji tmuxa, którą widzi panel webowy.

W środku kontenera `claude-panel/start.sh` (entrypoint) odpala równolegle:
- tmuxa z `claude --dangerously-skip-permissions` w sesji `cpa-tmux` na sockecie `/tmp/cpa-tmux/default` (jeśli już istnieje — tylko reload `tmux.conf`),
- `ttyd -p 7681 -i 127.0.0.1 -W -b /terminal tmux attach -t cpa-tmux` w tle (terminal w przeglądarce),
- `node --watch server.js` jako foreground (proces główny kontenera).

Panel siedzi na `https://localhost:8080` (goły HTTP → 307 na https). Edycja plików w `claude-panel/src/**` → `node --watch` restartuje serwer w kontenerze (bind-mount `./claude-panel:/srv` jest RW). Jeśli `fs.watch` nie złapie zmiany → `docker restart claude-panel`.

## Jedna usługa (`compose.yml`)

**`claude-panel`** — wszystko-w-jednym (Claude Code CLI + tmux + ttyd + Node HTTP serwer):
- `./` → `/app` (cały repo widoczny dla Claude'a — uploady i edycje plików projektu lądują tu).
- `./claude` → `/home/node/.claude` (sesje JSONL, OAuth, `.credentials.json` — to samo czyta panel pod `CLAUDE_DIR`).
- `./claude.json` → `/home/node/.claude.json`.
- `./claude-panel` → `/srv` (kod panelu, RW dla `node --watch`).
- `/var/run/docker.sock` → `/var/run/docker.sock` + `group_add: 998` (Claude Code CLI w środku może odpalać kontenery hostowe).
- Port `8080:8080`.

Env panelu (z `compose.yml`):
- `CLAUDE_DIR=/home/node/.claude`, `PORT=8080`
- `TMUX_SOCKET=/tmp/cpa-tmux/default`, `TMUX_TARGET=cpa-tmux` (jak puste → `POST /api/send` zwraca 500)
- `UPLOADS_DIR=/app/claude-panel/uploads` (gdzie panel zapisuje pliki z `POST /api/send`)
- `UPLOADS_CLAUDE_PATH=/app/claude-panel/uploads` (ścieżkę pod tym kluczem panel **wkleja w prompt** — bo Claude w tym samym kontenerze widzi tę samą ścieżkę)
- `TLS_HOSTNAMES=192.168.68.44` (dodatkowe SAN-y certu — dostęp z LAN; `TLS=off` wyłącza HTTPS, `TLS_CERT`/`TLS_KEY` = własny cert)
- `PANEL_PASSWORD=${PANEL_PASSWORD:-}` (hasło do panelu, z `.env` poza gitem; puste → panel zablokowany stroną z instrukcją; `PANEL_AUTH=off` = świadomie bez hasła)
- `PANEL_LANG=pl` (język UI: `pl` lub `en`, domyślnie `pl`. Ustawiane przy boocie kontenera; stringi wstrzykiwane jako `window.T` do klienta przez `src/ui/i18n.js`)

## Panel (`claude-panel/`)

```
claude-panel/
  server.js              ← entrypoint: listen + sniffing TLS/HTTP na jednym porcie + WS upgrade (auth.allowUpgrade → proxyWs)
  start.sh               ← entrypoint kontenera: tmux+claude (jeśli brak) + ttyd w tle + `node --watch server.js`
  tls-init.sh            ← cert serwera + jednorazowe CA (klucz CA kasowany po podpisaniu) per projekt w ${CLAUDE_DIR}/panel-tls; atomowa podmiana, walidacja TLS_HOSTNAMES
  Dockerfile             ← node:22-slim + tmux + ttyd + git + docker.io + @anthropic-ai/claude-code (multi-arch)
  tmux.conf              ← config dla tmuxa odpalanego w tym samym kontenerze
  uploads/               ← runtime; czyszczone na boot kontenera (nie na --watch restart)
  src/
    config.js            ← env vary + stałe (CLAUDE_DIR, PORT, MAX_UPLOAD_BYTES, MIME_TO_EXT, STARTUP_ID, LANG, …)
    tls.js               ← loadTls (walidacja pary, TLS≥1.2, ECDHE+AEAD; zły cert → null → http), GET /ca.crt (tylko bloki CERTIFICATE), handler gołego HTTP
    auth.js              ← hasło do panelu: guard (UI/REST/SSE/terminal → 302 /login albo 401, POST bez same-origin → 403), /login /logout, cookie HMAC per instalacja, revocation + track() (logout zamyka SSE/WS), allowUpgrade, rate limit
    files.js             ← saveFile, extFromName, sanitizeExt + mkdir uploads + wipe-on-boot
    sessions.js          ← readJSONL + rawCache, listSessions, summarize/parse/detectStatus, readHistory, stripMarkup
    sse.js               ← sseClients Set + broadcast + scheduleTick + startWatchers(fs.watch)
    tmux.js              ← runTmux/runTmuxRaw (send-keys -S socket) + sendText (literal+Enter) + sendInterrupt (Escape) + capturePane (cache 500ms)
    queue.js             ← server-side kolejka: enqueue/cancel/clearAll + worker (dispatch od razu, wstrzymany tylko gdy menu TUI na ekranie, fallback timer 2s)
    menu.js              ← parser menu wyboru z capture-pane (AskUserQuestion, plan approval) + polling/SSE + act() (strzałki+Enter / tekst)
    proxy.js             ← HTTP/WS proxy do ttyd na 127.0.0.1:7681 z injekcją CSS scrollbarów (route /terminal)
    usage.js             ← fetchUsage: api.anthropic.com/api/oauth/usage z OAuth tokenem z .credentials.json, cache 60s
    routes.js            ← dispatcher: GET / + /terminal + /healthz + /api/{sessions,session,latest,stream,commands,send,send-config,usage,pane,queue,queue/cancel,queue/clear,interrupt}
    ui/
      i18n.js            ← słowniki `pl` + `en` (locale, etykiety, plurale `plik/pliki/plików`); `pick(lang)` → dict
      styles.js          ← `(t) => CSS` (interpoluje stringi do pseudo-elementów `::after/::before`)
      body.js            ← `(t) => HTML body` markup z etykietami i placeholderami
      client.js          ← klient JS (~700 linii: routing, rendering, polling, attachments, SSE, pending render, pane preview); używa globalnego `window.T` dla wszystkich user-facing stringów
      index.js           ← czyta `LANG` z config, woła `pick(LANG)` i wstrzykuje wynik trzykrotnie: jako `<html lang="…">`, jako `styles(t)`/`body(t)`, oraz `<script>window.T=${JSON.stringify(t)}</script>` przed `client.js`
```

`node --watch server.js` chodzi po grafie `require(...)`, więc edycje w `src/**.js` triggerują restart.

### Co panel robi

1. **Przeglądanie sesji + transkryptów.** Czyta `${CLAUDE_DIR}/projects/<project>/<sessionId>.jsonl` (z bind-mounta na `~/.claude` w kontenerze), parsuje strumień zdarzeń JSONL i renderuje transkrypt w stylu Claude Code (user / assistant / tool_use / tool_result / thinking / system) z usuniętym markupem (`<command-name>`, `<system-reminder>`, `<local-command-*>` itd.).
2. **Live-tail aktywnej sesji.** `fs.watch` na `PROJECTS_DIR` + `HISTORY_FILE` → SSE eventy do podłączonych przeglądarek przez `/api/stream`. `detectStatus()` zwraca pigułkę "idle / thinking / working" per sesja na bazie ostatniego eventu user/assistant (zaślepione na 10 min, żeby porzucone sesje nie zostawały na "thinking" na zawsze).
3. **Subscription rate-limit usage** (paski 5h + 7d na górze panelu). `GET /api/usage` czyta `accessToken` z `${CLAUDE_DIR}/.credentials.json` i woła `https://api.anthropic.com/api/oauth/usage` z headerem `anthropic-beta: oauth-2025-04-20`. Cache server-side 60 s (deduplikuje burst z wielu kart); klient pinguje co 5 min + na load. Zwraca `{ok, session: {utilization, resets_at}, week: {utilization, resets_at}}` albo `{ok: false, error: "expired"|"no_token"|...}`. Na 401 panel pokazuje "token wygasł — uruchom claude" do czasu, aż Claude Code odświeży token w `.credentials.json` (panel re-czyta przy każdym fetchu).
4. **Wysyłanie wiadomości do sesji przez tmux.** `POST /api/send` wkleja text + opcjonalne base64 pliki przez `tmux send-keys -t <TMUX_TARGET>` na lokalnym sockecie `${TMUX_SOCKET}`. Pliki idą do `${UPLOADS_DIR}`, a w prompt wklejana jest ścieżka `${UPLOADS_CLAUDE_PATH}/...` — taką widzi Claude Code w tym samym kontenerze. Obrazki (`image/*`) jako `[image: <path>]` (Claude auto-attach), reszta jako goła ścieżka (Claude `Read`-uje na żądanie).
5. **Wbudowany terminal** (`/terminal`). `start.sh` odpala `ttyd -p 7681 -i 127.0.0.1 -W -b /terminal tmux attach -t cpa-tmux` w tle obok node serwera. Klient panelu otwiera nową kartę pod `/terminal/`, którą serwer Node proxuje (HTTP + WS upgrade) do ttyd. `proxy.js` wstrzykuje też CSS scrollbarów do indeksowego HTML-a ttyd. Pełny tmux w przeglądarce — co widzisz w `docker exec … attach`, widzisz tutaj.

6. **Podgląd pane'a w UI** (toggle "podgląd CLI"). `GET /api/pane` woła `tmux capture-pane -p -t <target>` (cache 500ms po stronie serwera) i zwraca aktualną zawartość pane'a jako tekst. Klient pinguje co 1.5s tylko na widoku "Najnowsze" i tylko gdy toggle jest włączony — pokazuje co Claude Code TUI ma teraz na ekranie (z input boxem włącznie). Drugie źródło prawdy obok JSONL: jak wysyłka mid-thinking siedzi jeszcze w bufferze TUI, tu ją zobaczysz.

7. **i18n (PL + EN).** Język UI wybierany przez `PANEL_LANG` (`pl` default, `en` opcjonalnie) przy boocie kontenera. Wszystkie user-facing stringi siedzą w `src/ui/i18n.js` (~80 kluczy: tabs, usage, search, send-form, statusy, toasty, empty-states, daty, plurale `plik/pliki/plików`, oraz CSS pseudo-elementy typu "▸ pokaż całość"). `index.js` czyta `LANG` z config raz przy pierwszym `require`, woła `pick(lang)` i wstrzykuje słownik trzema kanałami: server-side jako interpolacje w `styles(t)`/`body(t)`, oraz client-side jako `window.T = {...}` przed `<script>${client}</script>`. `client.js` używa `T.<key>` zamiast hardcoded stringów; helper `fileWord(n)` dobiera polskie 3-formy plurale (1 / 2-4 / 5+). Dodanie nowego języka = dopisać dict do `i18n.js` i rozszerzyć whitelist w `config.js` (`PANEL_LANG === "xx"`). Zmiana `PANEL_LANG` wymaga restartu kontenera (env load-once przy boocie); samo `node --watch` nie wystarczy.

8. **Optymistyczne renderowanie własnych wysyłek + server-side kolejka + Esc.**
    - **Pending render.** Po `POST /api/send` klient od razu wstawia event do feedu z klasą `.pending` ("w kolejce…" / "wysyłam…" / "wysłane, czekam na claude…" w zależności od stanu z SSE). Gdy realny wpis pojawi się w JSONL, `reapPending` paruje po znormalizowanym tekście (prefix-matching dla payloadów ze ścieżką uploadu) i zdejmuje pending. Po 30s bez parowania pending dostaje klasę `.stuck` (czerwony "brak odpowiedzi z tmux") z lokalnym przyciskiem ×.
    - **Server-side queue (`queue.js`).** `POST /api/send` enqueue'uje w pamięci kontenera, a worker **od razu** robi `sendText` (tekst + Enter), także gdy Claude pracuje — tak jak pisanie w terminalu; Claude Code sam kolejkuje input, który przyjdzie w trakcie turnu ("Press up to edit queued messages"). Kolejka tylko serializuje wysyłki (300ms odstępu) i **wstrzymuje je, gdy na ekranie jest menu wyboru** (`menu.js`) — inaczej cyfry/Enter wybrałyby opcję w dialogu. Trigger workera: na enqueue, na każdym SSE ticku z fs.watch, oraz fallback timer 2 s. Każda zmiana stanu (added/sending/sent/cancelled/error/cleared/dropped) leci jako SSE event `{type:"queue", event, queue:[...], id}`.
    - **Cancel.** `POST /api/queue/cancel?id=` zdejmuje z kolejki (zwraca 409 jak już `sending`). Klient pokazuje × na każdym pending z `_queueId`. Errored/stuck mają lokalny dismiss (`data-local-pid`).
    - **Esc.** Przycisk × w kółku w `send-form` (obok załączania plików) — `POST /api/interrupt` → `tmux send-keys Escape` → Claude przerywa bieżący turn. Disabled gdy `status==='idle'`, czerwony gdy aktywny, czerwone tło na hoverze.

9. **Menu wyboru z TUI (`menu.js`)** — `AskUserQuestion`, akceptacja planu i inne numerowane menu Claude Code. Serwer co 1 s (co 5 s bez podłączonych klientów SSE) robi `capture-pane` i parsuje ekran: linie `❯ 1. …` / `  2. …`, opisy pod nimi, checkboxy `[ ]`/`[✔]` (multiSelect), wiersz `Submit`, pasek zakładek `← ☐ A ☐ B ✔ Submit →`, pole „Type something” (opcja tuż przed „Chat about this”). Zmiana stanu → SSE `{type:"menu", menu|null}`. Klient pokazuje kartę `#menu-card` nad `send-form` z dużymi przyciskami (działa na telefonie). Każda akcja = strzałki od kursora do pozycji + `Enter` (wybór / toggle / Submit); tekst = nawigacja + `BSpace`×stara wartość + literal (+ `Enter` przy single-select). Kolejka **nie dispatchuje, gdy menu jest na ekranie**.
    - **Dlaczego pane, a nie JSONL:** wpis assistant z `tool_use` `AskUserQuestion` bywa zapisywany do JSONL dopiero **po** odpowiedzi — przy otwartym dialogu JSONL często kończy się na prompcie usera (→ `detectStatus` = thinking → po 2 min idle).
    - Menu jest uznawane tylko gdy jest ostatnie na ekranie (pod nim max stopka, bez `────`/`❯`), N≥2 opcji numerowanych od 1 — echo listy `❯ 1. …` z wiadomości usera w transkrypcie nie łapie się.
    - `sig` (nagłówek + etykiety, bez kursora/checkboxów) chroni przed klikaniem w menu, które już zniknęło/zmieniło się → 409.

### HTTP API

- `GET /` — SPA (HTML+CSS+JS inline w odpowiedzi). Locale wybierane przez `PANEL_LANG` (`pl`/`en`, default `pl`) — patrz §"i18n" niżej.
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
- `POST /api/btw` — body `{ question }`. Wysyła `/btw <question>` do TUI **omijając kolejkę** + uruchamia watcher `btw.js` który tail'uje `capture-pane` i broadcastuje do SSE. Zwraca `{ok, id}`. Bez załączników, bez parowania z JSONL (Claude Code'owy `/btw` to TUI overlay — nie zapisuje do JSONL, jedyne źródło to bufor pane'a). SSE: `{type:"btw-start", id, question}`, `{type:"btw-tick", id, text}` (~co 800 ms), `{type:"btw-end", id, reason, closed}`.
- `POST /api/btw/close?id=` — kończy watcher i wysyła `Escape` do tmuxa, żeby zamknąć overlay `/btw` i odblokować normalną konwersację. 200 jak ok, 404 jak nie ma takiego id.
- `GET /api/menu` — `{ ok, menu }`: aktualnie otwarte menu TUI albo `null`. `menu = {tabs, header, multi, items:[{idx, kind:"option"|"text"|"submit", n, label, desc, checked, cursor, value}], footer, sig}`.
- `POST /api/menu` — body `{ sig, action }`, `action` = `{type:"select", idx}` | `{type:"text", idx, text}` | `{type:"key", key:"Escape"|"Left"|"Right"|"Tab"|"BTab"}`. 409 gdy `sig` nie pasuje do ekranu. Zwraca `{ok, menu}` ze stanem po akcji.
- `GET /ca.crt` — CA projektu do opcjonalnej instalacji (tylko po HTTPS — po gołym HTTP 307; 404 przy własnym certyfikacie / `TLS=off`).
- `GET/POST /login`, `POST /logout` — logowanie hasłem `PANEL_PASSWORD` (form, cookie `cpa_<hash>` 30 dni). Logout unieważnia token po stronie serwera i zamyka jego SSE/WS; `GET /logout` → tylko redirect na `/` (bez CSRF-owego wylogowania).
- `GET /healthz` — `{ ok: true }`.

### Gotchas

- **Uploady kasują się na real container boot, nie na `--watch` restart.** Marker `/tmp/claude-panel-boot-marker` przeżywa restart procesu z `node --watch`, ale ginie na `docker compose up`. Czyli edycje kodu nie czyszczą uploadów, a recreate kontenera — czyści.
- **`node --watch` gubi pliki podmieniane przez rename.** Edytory (w tym narzędzia Claude'a) zapisują przez temp+rename → nowy inode, watcher siedzi na starym. Pierwsza edycja pliku restartuje serwer, kolejne edycje tego samego pliku już nie. Obejście bez restartu kontenera (który zabija tmuxa z Claude'em): `touch server.js`.
- **Wiadomości wysłane w trakcie turnu nie mają wpisu `user` w JSONL.** Claude Code wchłania je do bieżącego turnu i loguje tylko jako `{"type":"attachment","attachment":{"type":"queued_command","prompt":…}}` (+ `queue-operation` z `reason:"absorbed_mid_turn"`). `parseSession` zamienia je na zwykły event `user` — bez tego pending w panelu nigdy się nie paruje (→ „brak odpowiedzi z tmux”), a wiadomość nie pojawia się w transkrypcie. Wiadomości zakolejkowane, które poszły dopiero po turnie, mają normalny wpis `user` (`promptSource:"queued"`).
- **Raw events są cache'owane po (mtime, size)** w `rawCache` (max 64 plików). Inwalidacja automatyczna na zmianę pliku — bez ręcznego bustowania.
- **SSE `scheduleTick`** jest debounce'owany, żeby przy szybkim zapisywaniu JSONL nie generować eventu na linię.
- **Slash-command meta-entries** (`/clear` itd.) są skipowane w `detectStatus` — wpis usera bez odpowiedzi assistanta nie zostawia "thinking" na zawsze.
- **`send-keys -l`** (literal mode) — żeby specjalne znaki nie były interpretowane jako tmux key bindings. Newline'y są wycinane z `text` (tmux zjadałby je jako osobne klawisze).
- **Hasło do panelu (`src/auth.js`).** `auth.guard` jest pierwszą linią `routes.js#handle` — chroni UI, REST, SSE i `/terminal`; publiczne tylko `/healthz` i `/ca.crt`. WebSocket chroni osobno `auth.allowUpgrade` w `server.js#onUpgrade` (cookie + same-origin) — **każda nowa ścieżka upgrade musi przejść przez `onUpgrade`**. **CSRF:** każdy request ≠ GET/HEAD (także `/login`, także przy `PANEL_AUTH=off`) wymaga `Sec-Fetch-Site: same-origin` albo `Origin` == `Host`/`X-Forwarded-Host` — SameSite=Lax nie chroni przed same-site (inny port tego hosta, subdomena), a `/api/send` = prompt do Claude'a. Bez `PANEL_PASSWORD` (i bez `PANEL_AUTH=off`) panel zwraca 503 ze stroną-instrukcją. Token = `exp.nonce.HMAC(KEY, exp.nonce)`, `KEY = HMAC(sekret, hasło)` — zmiana hasła unieważnia sesje, sekret w `${CLAUDE_DIR}/panel-auth.key` (wyciek cookie nie pozwala zgadywać hasła offline). Nazwa cookie `cpa_<sha256(KEY)[:10]>` — cookies ignorują port, stała nazwa = projekty na jednym hoście wylogowują się nawzajem. Wylogowane sygnatury w `${CLAUDE_DIR}/panel-auth.revoked`; `auth.track(req, socket)` rejestruje SSE/WS per sesja, logout je niszczy. `safeNext` przepuszcza tylko drukowalne ASCII (TAB → open redirect, nie-Latin1 → crash `writeHead`). Rate limit: 5 prób/adres (IPv6 /64), blokada 30 s podwajana do 15 min, licznik wygasa po 1 h, mapa max 10k z wyrzucaniem najstarszych (nigdy `clear()`). `process.on("uncaughtException")` w `server.js` — pod `node --watch` crash = panel leży do ręcznego restartu. Klient: wrapper `fetch` → na 401 zapis draftu do `sessionStorage` + przekierowanie na `/login`; SSE zamknięte na stałe (401/502) → sonda `/api/queue`; `proxy.js` wstrzykuje do ttyd skrypt, który po zamknięciu WS przy 401 przenosi na login. Hasło chroni przed siecią, nie przed Claude'em w kontenerze (widzi compose/env). Mimo hasła nie wystawiać 8080 do internetu.
- **Obraz odpala Claude Code z `--dangerously-skip-permissions`.** To celowe (panel sam moderuje), ale konsument obrazu musi to wiedzieć — całość runtime'u zakłada zaufaną sesję pod kontrolą operatora panelu.
- **`claude-panel/Dockerfile` startuje `node --watch server.js`.** Edycje `server.js`/`src/**` auto-reload bez rebuildu — `compose.yml` montuje `./claude-panel` RW do `/srv`.
- **`PANEL_LANG` jest load-once przy boocie.** `INDEX_HTML` jest cache'owane po pierwszym `require("./ui")`, więc zmiana env w czasie życia kontenera nie ma efektu — wymaga `docker compose up -d` (recreate). Pliki `i18n.js`/`styles.js`/`body.js` są fine na `--watch` restart.
- **HTTPS i HTTP na jednym porcie.** `server.js` przy TLS stawia surowy `net.Server` (`noDelay`, 10 s timeout do pierwszego bajtu), podgląda pierwszy bajt (`0x16` = TLS ClientHello) i oddaje socket do `https.Server` albo do `http.Server` z `createPlainHandler`. Wewnętrzne serwery nie robią `listen()`, więc po `listen` zewnętrznego dostają ręczne `emit("listening")` — bez tego nie działają `headersTimeout`/`requestTimeout` (slowloris). Goły HTTP: `X-Forwarded-*`/`Forwarded` → normalny panel (reverse proxy, bez pętli redirectów); `/healthz` → 200; `/api/stream` → jeden `hello` ze `startup:"tls-redirect"`, żeby stara karta HTTP sama się przeładowała; reszta → **307** (nie 308 — przeglądarki cache'ują 308 na zawsze, `TLS=off` by nie pomógł).
- **Cert per projekt, akceptowany kliknięciem.** `${CLAUDE_DIR}/panel-tls` — zero zmian w compose, nic w obrazie. Klucz CA jest kasowany zaraz po podpisaniu (instalacja CA nie daje możliwości podrobienia innej domeny). Cert trwały, regeneracja tylko przy zmianie SAN-ów / 30 dni przed wygaśnięciem — każda = ponowna akceptacja w przeglądarce. `tls-init.sh` biegnie tylko w `start.sh` (boot kontenera) — zmiana `TLS_HOSTNAMES` wymaga recreate. Ograniczenia: iOS Safari nie respektuje wyjątku dla WebSocketów (terminal wymaga instalacji CA), Chrome pamięta wyjątek ~7 dni, Firefox jeden wpis na host:port (wiele projektów na `localhost:8080` = akceptacja przy każdym przełączeniu). ttyd za proxy zostaje na gołym HTTP po `127.0.0.1`.

## Release / CI (`.circleci/config.yml`)

- Trigger: push taga `v*` (np. `v0.1.0`). Opcjonalnie ręczny przez Pipeline parameter `manual_build=true`.
- Build: `docker buildx` na `setup_remote_docker`, multi-arch `linux/amd64,linux/arm64` (QEMU przez `tonistiigi/binfmt`), kontekst `./claude-panel`.
- Publish: Docker Hub jako `${DOCKERHUB_USER}/claude-panel` z tagami `${CIRCLE_TAG}`, semver short (np. `0.1`, `0`), `latest` + `${sha7}`.
- Login: `docker/check` z orba `circleci/docker@3.0.1` używa env `DOCKERHUB_USER` + `DOCKERHUB_TOKEN` (z Context `dockerhub-publish` w CircleCI). Token: hub.docker.com → Account Settings → Personal access tokens, scope `Read, Write, Delete`.
- Project Settings → Advanced → "Build pipelines on tag pushes" musi być **on** (domyślnie off).
- Repo na Docker Hub auto-tworzy się na pierwszym pushu jako **public** (free tier). Jeśli chcesz prywatne — stwórz repo wcześniej z odpowiednią widocznością albo zmień w *Settings* po pierwszym pushu.

## Wpinanie do innych projektów (cel długoterminowy)

Konsument nie kopiuje już kodu — tylko ściąga obraz:

```yaml
services:
  claude-panel:
    image: <dockerhub-user>/claude-panel:latest
    volumes:
      - .:/app
      - ./.claude-data:/home/node/.claude
      - ./.claude.json:/home/node/.claude.json
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      CLAUDE_DIR: /home/node/.claude
      PORT: "8080"
      TMUX_SOCKET: /tmp/cpa-tmux/default
      TMUX_TARGET: cpa-tmux
      UPLOADS_DIR: /app/claude-panel/uploads
      UPLOADS_CLAUDE_PATH: /app/claude-panel/uploads
      PANEL_LANG: pl   # lub "en"
      PANEL_PASSWORD: ${PANEL_PASSWORD}   # wymagane (z .env) — bez tego panel pokazuje tylko instrukcję
      # TLS_HOSTNAMES: "192.168.1.10"   # IP/hosty z LAN w certyfikacie
    ports: ["8080:8080"]
    group_add: ["998"]
```

Quick start dla konsumenta → README. Przy zmianach w panelu pilnować, żeby nic nie zakładało konkretnego layoutu repo gospodarza poza tym, co jest w `compose.yml`/env.
