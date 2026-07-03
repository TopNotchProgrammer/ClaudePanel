# Claude-panel — lista rzeczy do poprawy

Przegląd całego projektu (nie tylko brancha `tts`). Priorytety dostrojone do faktu,
że to **prywatne, wewnętrzne narzędzie z jednym zaufanym użytkownikiem** — klasa
"atakujący wstrzykuje X" jest opisana, ale zepchnięta niżej, bo atakujący = operator.

> **Status prac:** ✅ Etap 1 zrobiony — #1 (crash `/api/latest`), #8 (język TTS),
> #9 (`_ttsSpokenIndexes`), #14 (`przerwano` → i18n), #18 (CLAUDE.md). Zweryfikowane
> asercjami runtime (brak live E2E — docker niedostępny w tym środowisku).
> Do zrobienia: Etap 2 (kolejka: #2+#3, potem #4), Etap 3 (ASR/TTS: #5–#7),
> Etap 4 (refaktor: #17).

Legenda pilności:
- 🔴 **wysoka** — psuje normalną pracę narzędzia, trafia Cię przy zwykłym użyciu
- 🟡 **średnia** — funkcjonalny bug w konkretnej ścieżce (ASR, TTS, `/btw`)
- 🟢 **niska** — jakość życia / sprzątanie / dokumentacja
- ⚪ **kontekstowa** — realny bug tylko przy wrogim wejściu (dla tego narzędzia mało istotne)

---

## 🔴 Wysoka pilność — walą przy normalnym użyciu

### 1. Crash całego panelu przy rotacji pliku sesji — `src/routes.js:82`
`/api/latest` rozwiązuje odpowiedź wewnątrz `filterStaleP.then(...)` bez `.catch`,
poza zewnętrznym `try`. `readJSONL` (`src/sessions.js:6`) robi niezabezpieczony
`fs.readFileSync`, a `getRawEvents` łapie w `try/catch` tylko `statSync`. Jeśli
najnowszy `.jsonl` zniknie/zrotuje się **między** `statSync` a `readFileSync`,
rzut ENOENT staje się unhandled promise rejection.

**Skutek:** przy domyślnej polityce Node (`--unhandled-rejections=throw`) proces
panelu pada — spadają wszystkie SSE, ginie kolejka trzymana w pamięci, request
wisi bez odpowiedzi.

**Fix:** owinąć callback `.then` w `try/catch` (albo przepisać handler na
`async/await` w istniejącym `try`) i dodać `.catch` zwracający 500. Rozważyć
guard na `readFileSync` w `getRawEvents`.

---

### 2. Kolejka wysyłki zablokowana na zawsze przez martwą sesję — `src/sessions.js:175`
Gdy ostatnie zdarzenie JSONL to `tool_use` (assistant) albo `tool_result` (user),
`detectStatus` zwraca `"working"` **bez żadnego limitu wieku** (cap 2 min istnieje
tylko na gałęzi `"thinking"`). `queue.js` `isReady()` dispatchuje wyłącznie przy
`"idle"`.

**Skutek:** jeśli Claude Code zostanie ubity/zrestartowany w trakcie tool-runu,
JSONL kończy się na `tool_use` bez wyniku → status na wieki `"working"` →
każda wysłana z panelu wiadomość zostaje `"w kolejce…"` bez końca i nigdy nie
trafia do tmux. Jedyny ratunek to ręczny Esc (arming 60 s grace window).

**Fix:** dodać cap wieku również na gałęzi `"working"` (np. ten sam próg co
`"thinking"`) — po przekroczeniu traktować jako `"idle"`.

---

### 3. Sklejanie promptów przy długim myśleniu — `src/sessions.js:191`
`detectStatus` flipuje sesję na `"idle"`, gdy ostatnia zwykła wiadomość usera jest
starsza niż **2 minuty** (`if (age > 2 * 60 * 1000)`). CLAUDE.md **i komentarz w
kodzie mówią o 10 minutach** — kod się z nimi rozjeżdża.

**Skutek:** turn, w którym Claude zwleka >2 min z pierwszym tokenem (np. retry
przeciążonego API, długie myślenie), flipuje na `"idle"`; worker kolejki wpisuje
kolejną wiadomość w zajęty TUI, gdzie skleja się z trwającym turnem. To dokładnie
awaria, której serwerowa kolejka ma zapobiegać.

**Fix:** podnieść próg do udokumentowanych 10 min (`10 * 60 * 1000`) albo — lepiej —
skorelować z `capturePane` zamiast czasowej heurystyki. Minimum: zsynchronizować
kod z komentarzem/CLAUDE.md.

---

### 4. Pełne synchroniczne re-parsowanie JSONL na każdy poll — `src/sessions.js:22`
`getRawEvents` cache'uje surowe linie po `(mtimeMs, size)`, ale przy każdej zmianie
robi pełny `readFileSync` + `JSON.parse` per linia. `parseSession`,
`summarizeSession` i `detectStatus` **nie są cache'owane wcale** — liczą się od nowa
z surowych zdarzeń przy każdym wywołaniu.

**Skutek:** podczas aktywnej sesji każdy flush assistanta dopisuje do JSONL i busti
cache; każdy poll `/api/latest` z każdej otwartej karty re-czyta cały plik (potrafi
mieć dziesiątki MB) synchronicznie na event-loopie — `O(rozmiar)` per append,
`O(rozmiar²)` narastająco przez sesję. Dławi pozostałe requesty (SSE, `/api/send`).

**Fix:** cache'ować wynik `parseSession`/`summarizeSession` po `(mtime, size)` obok
surowych zdarzeń; docelowo czytać tylko dopisany ogon (offset bajtowy + `fs.read`)
i przejść na odczyt asynchroniczny.

---

## 🟡 Średnia pilność — funkcjonalne bugi w konkretnych ścieżkach

### 5. Mikrofon nigdy się nie pojawia po świeżym boocie — `src/ui/client.js:1542`
`checkAsr` pinguje `/api/asr/health` najwyżej ~6× co 5 s (~30 s łącznie), potem się
poddaje. `asr/server.py` ładuje Whisper large-v3 + XTTS w `@app.on_event("startup")`,
które uvicorn kończy **przed** serwowaniem czegokolwiek — na pierwszym boocie to
minuty (pobieranie modeli). Przycisk mikrofonu jest ukryty (`display:none`) do klasy
`.available`.

**Skutek:** karta otwarta w oknie ładowania modeli wyczerpuje wszystkie retry →
`micBtn` nigdy nie dostaje `.available` → dyktowanie bezużyteczne do ręcznego
przeładowania strony.

**Fix:** retry z backoffem bez twardego limitu (albo dużo wyższy limit), ewentualnie
ciągły polling w tle póki nie `available`.

---

### 6. `/btw` z załącznikiem zatyka konwersację — `src/ui/client.js:271`
`/btw ...` jest kierowane przez specjalny flow (`/api/btw` + watcher) **tylko gdy
nie ma załączników**. Z załącznikiem `if (!pendingAttachments.length)` nie łapie i
tekst spada do zwykłego `submitPayload` → `/api/send`.

**Skutek:** payload `/btw pytanie [image: …]` idzie przez tmux → Claude otwiera
overlay `/btw` **bez** `btw.js` watchera i bez podpiętego przycisku close; worker
kolejki widzi potem status non-idle i się zatyka; optymistyczny pending nigdy nie
sparuje z JSONL (bo `/btw` nic do JSONL nie pisze) i po 30 s robi się czerwony
`"stuck"`.

**Fix:** albo kierować `/btw` przez flow niezależnie od załączników (i odrzucać
załączniki dla `/btw`), albo jawnie blokować `/btw` z plikami z czytelnym komunikatem.

---

### 7. Martwy `413` w `/api/asr` i `/api/tts` — `src/routes.js:282`
Ścieżka "za duże" woła `req.destroy()` w handlerze `'data'`. Po `destroy()`
zdarzenie `'end'` już **nie odpali**, a `json(res, 413, ...)` siedzi właśnie w
handlerze `'end'` → to martwy kod.

**Skutek:** przy uploadzie >10 MB do `/api/asr` serwer niszczy socket w trakcie,
klient dostaje reset połączenia zamiast `413` → `fetch` odrzuca generycznym błędem
sieci, UI mikrofonu nie daje żadnej informacji o rozmiarze.

**Fix:** odpowiedzieć `413` **przed** `destroy()` (lub w handlerze `'aborted'`/`'close'`),
tak żeby klient dostał ustrukturyzowany `{ok:false}`.

---

### 8. TTS zawsze z polską fonetyką — `asr/server.py:91`
Endpoint `/tts` ma na sztywno `language="pl"`; `src/tts.js` i `/api/tts` nie
przekazują żadnego pola języka (multipart zawiera tylko `text`).

**Skutek:** przy `PANEL_LANG=en` angielski tekst odpowiedzi jest syntezowany z polską
fonetyką — bełkotliwa wymowa.

**Fix:** przekazywać język z panelu (`PANEL_LANG`) przez `/api/tts` → `tts.js` →
`Form(language)` w `server.py`, analogicznie do tego jak ASR honoruje `?lang=`.

---

### 9. `_ttsSpokenIndexes` nie czyszczone przy zmianie sesji — `src/ui/client.js:1717`
`_ttsSpokenIndexes` jest kluczowane po per-sesyjnym indeksie zdarzenia `_i`
(`routes.js:88` robi `events[i]._i = i`) i **nigdy nie jest czyszczone** — jedyne
zapisy to `1674/1717/1718`, brak resetu przy przełączeniu feedu.

**Skutek:** po `/clear` (nowa sesja) `pollLatest` przebudowuje feed, ale zachowuje
`_ttsSpokenIndexes`; odpowiedzi nowej sesji na indeksach już zaznaczonych w starej są
po cichu nigdy nie wypowiadane przy aktywnym trybie mikrofonu/TTS.

**Fix:** czyścić `_ttsSpokenIndexes` przy wykryciu zmiany `sessionId` w `pollLatest`.

---

## 🟢 Niska pilność — jakość życia, sprzątanie, dokumentacja

### 10. `switchModel` omija kolejkę i strzela ślepym Enterem — `src/model.js:49`
`routes.js:333` woła `switchModel` bezpośrednio (bez `enqueue`, bez idle-check).
`model.js:49` po `setTimeout 1200 ms` odpala bezwarunkowy
`runTmux(... "send-keys" "Enter")` — poza `sendChain`, który serializuje `sendText`.

**Skutek:** (a) mid-turn tekst `/model X` jest łykany jako steering message (model się
nie przełącza, a panel i tak toastuje "restartuję claude…"); (b) ślepy Enter może
wpaść między `-l text` a Enterem współbieżnego `sendText`, albo zatwierdzić draft,
który operator wpisał ręcznie w zakładce `/terminal`.

**Fix:** przepuścić przełączanie modelu przez tę samą serializację co `sendText`;
zamiast ślepego sleepu obserwować `capturePane`, żeby potwierdzić dialog przed Enterem.

---

### 11. Grace-window 60 s w kolejce dispatchuje niezależnie od statusu — `src/queue.js:79`
`isReady()` zwraca `true` przez 60 s po Esc (`INTERRUPT_GRACE_MS`) **bez względu na
`detectStatus`**. Grace czyści się dopiero po dispatchu.

**Skutek:** jeśli w tym oknie faktycznie ruszy nowy turn (operator wpisał coś wprost
w TUI/terminalu, albo Esc nie wylądował), worker wpisuje kolejny item w aktywny turn —
sklejanie, któremu kolejka ma zapobiegać. Łamie udokumentowany kontrakt "dispatch
tylko przy idle".

**Fix:** zawęzić grace do sytuacji, gdy status faktycznie jest `idle`/przejściowy,
albo skrócić okno i sprzęgnąć z realnym sygnałem z `capturePane`.

### 12. Wyścig 300 ms po dispatchu — `src/queue.js:140`
Po `sendText` worker czeka na sztywno 300 ms i re-sprawdza `isReady`. Jeśli zdarzenie
usera jeszcze nie wylądowało w JSONL (wolne I/O bind-mounta, duży plik), `detectStatus`
wciąż czyta `idle` i item #2 jest wpisany, gdy turn #1 dopiero startuje.
**Fix:** czekać na faktyczne potwierdzenie (pojawienie się zdarzenia usera w JSONL
via istniejący `fs.watch`), nie na stałą.

### 13. `sendText` nie jest atomowe — `src/tmux.js:46`
Literalny `send-keys` i następujący Enter to dwa osobne `runTmux` (każdy z 5 s
timeoutem). Jeśli tekst wejdzie, a Enter padnie/timeoutuje, tekst zostaje w input
boxie; `queue.js:129` na błąd tylko zdejmuje item i `continue`, więc następny dispatch
skleja się z resztką. **Fix:** przy błędzie Enter wysłać Escape/wyczyścić input przed
kolejnym itemem.

### 14. Hardcoded polskie `'przerwano'` bez i18n — `src/ui/client.js:385`
`showToast('przerwano', 'ok')` — dosłowny polski string; brak klucza w `i18n.js`
(jest tylko label przycisku `interruptClaude`). Angielskie UI pokazuje polski toast.
**Fix:** dodać klucz `interrupted` do obu słowników i użyć `T.interrupted`.

### 15. Niespójny fallback socketa tmux — `src/routes.js:342` + 8 innych miejsc
`/api/send-config` zwraca `process.env.TMUX_SOCKET || ""`, a wszystkie pozostałe
miejsca (`routes.js:77/180/205/236/330`, `queue.js:113`, `nudge.js:8/24`) fallbackują
na `"/host-tmux/default"` — ścieżkę, której **nie ma** w tym obrazie (`start.sh`
domyśla `/tmp/cpa-tmux/default`, ale nie eksportuje do node). Jedyny guard 500
sprawdza `TMUX_TARGET`, nie socket. CLAUDE.md twierdzi "jak puste → `POST /api/send`
zwraca 500", co nie jest prawdą.
**Skutek:** przy nieustawionym `TMUX_SOCKET` kolejka przyjmuje wysyłki (200), po czym
cicho failuje na nieistniejącym sockecie — trudne do wytropienia.
**Fix:** wyeksportować `TMUX_SOCKET`/`TMUX_TARGET` z `config.js` raz, z jednym
spójnym domyślnym (`/tmp/cpa-tmux/default`); guard na pusty socket → 500.

### 16. reapPending paruje po prefiksie tekstu — `src/ui/client.js:1209`
`reapPending` koreluje optymistyczny pending z realnym zdarzeniem JSONL po
znormalizowanym prefiksie tekstu. Dispatch FIFO zwykle trafia, ale dwie
prefiksowo-nakładające się wiadomości (albo zdarzenie z innego źródła — attached
tmux/terminal) mogą sparować zły pending → prawdziwy idzie na czerwony `"stuck"` po
30 s. JSONL faktycznie nie niesie `pendingId`, ale zdarzenie SSE `sent` z kolejki
(`handleQueueEvent`) jest niewykorzystanym sygnałem, który mógłby zakotwiczyć parowanie.
**Fix (opcjonalny):** użyć SSE `sent` do zakotwiczenia, który pending faktycznie
poszedł.

### 17. Duplikacje kodu (reuse/simplification)
- **Kolektor body 6×** — `routes.js` `/api/send`, `/api/btw`, `/api/goal`, `/api/asr`,
  `/api/tts`, `/api/model` mają skopiowany chunks/total/JSON.parse z **rozjechanym**
  zachowaniem (limity 25MB/256KB/10MB/100KB, `/api/goal` i `/api/model` bez limitu,
  silent-drop vs 413). → jeden `readJsonBody(req, maxBytes)`.
- **Klient multipart 2×** — `tts.js` re-implementuje maszynerię `asr.js` (boundary,
  `new URL(ASR_URL)`, `http.request` z 30 s timeoutem, chunk-collect, error/timeout);
  `asr.js` `checkHealth` powtarza wzorzec po raz trzeci. → jeden `postMultipart`.
- **Normalizacja newline** — `.replace(/\r/g,"").replace(/\n/g," ").trim()` w
  `queue.js`, `routes.js:147`, `routes.js:178` i client-side `client.js:269`. →
  jeden helper (najlepiej z `tmux.js`, którego ograniczenie to motywuje).
- **Fallback socketa** re-derived 9× (patrz #15). → do `config.js`.
- **Ścieżka pliku sesji** — `model.js:27` sam składa `PROJECTS_DIR/project/id.jsonl`,
  co `sessions.js` powtarza wewnętrznie w 3 miejscach. → `sessions.sessionFile(id, project)`.
- **`invalidateFeedRender`** — para `lastRenderedMaxIndex=null; renderLatest(...)`
  wklejona ~10–12× w `client.js`. → jeden helper.
- **Martwe klucze i18n** — `micTranscribing`, `evBtw`, `modelLoading` w obu
  słownikach, nigdzie nieużywane. → usunąć.
- **Nieużywane serwerowe `pendingId`** — threadowane z POST przez `routes.js` do
  itemu kolejki, nigdzie po stronie serwera nieczytane (klient paruje po `_queueId`);
  do tego `pendingId`/`_pendingId` zdublowane w `submitPayload`. → usunąć.

### 18. CLAUDE.md rozjechany z kodem
Doc jest źródłem prawdy dla architektury, a nie opisuje nowych rzeczy z brancha `tts`:
- **Moduły** `src/model.js`, `src/tts.js`, `src/asr.js`, `src/nudge.js`, `src/btw.js`
  nie ma w drzewie layoutu `src/`.
- **Endpointy** `GET/POST /api/goal`, `GET /api/asr/health`, `POST /api/asr`,
  `POST /api/tts`, `GET/POST /api/model` nie ma w liście HTTP API.
- **Env vary** `ANTHROPIC_MODEL`, `ASR_URL`, `MODELS_DIR`, `WHISPER_MODEL`,
  `TTS_REF_WAV` (compose.yml) — nie ma w sekcji "Env panelu".
- **TLS** — `server.js` warunkowo odpala HTTPS z `TLS_KEY`/`TLS_CERT`; CLAUDE.md
  opisuje `server.js` jako czysty http `~20 linii`.
→ zaktualizować CLAUDE.md, żeby odzwierciedlał stan `tts`.

---

## ⚪ Kontekstowe — realne tylko przy wrogim wejściu (dla prywatnego narzędzia mało istotne)

Zostawione świadomie na dole: model zagrożeń to jeden zaufany operator, więc
"atakujący wstrzykuje X" ma znikomą wartość. Warto znać, gdyby narzędzie kiedyś
wyszło poza localhost.

- **XSS w linkach markdown — `src/ui/client.js:970`.** `esc()` (linia 656) escapuje
  tylko `& < >`, nie `"`; URL linka markdown (regex dopuszcza `"`) wchodzi surowo w
  `href="..."`, więc `[x](https://a"onmouseover="alert\`1\`)` wyłamuje się z atrybutu
  i wstrzykuje handler. Realne tylko, gdy Claude renderuje wrogą treść z web do
  przeglądarki. Tani fix i tak warty zrobienia: escapować `"` w `esc()`.
- **Wstrzyknięcie promptu przez newline — `src/nudge.js:12` / `routes.js` `/api/model`.**
  `condition`/`modelId` tylko `trim()`, bez wycinania `\n` (inaczej niż `/api/send`);
  newline w `send-keys -l` działa jak Enter → dodatkowy prompt. "Atakujący" to
  operator, więc to raczej **bug funkcjonalny** (newline rozjedzie wysyłkę `/goal`)
  niż luka. Fix: ta sama normalizacja newline co w `/api/send`.
- **Brak limitu body w `/api/goal` i `/api/model` — `routes.js:249/323`.** Nieograniczone
  buforowanie → OOM. Self-DoS, nieistotne dla jednego operatora; i tak domknie się
  przy okazji `readJsonBody` z #17.

---

## Sugerowana kolejność

1. **#1, #2, #3** — crash, zawieszona kolejka, sklejanie promptów. Trzy małe,
   ograniczone zmiany, każda psuje normalną pracę.
2. **#4** — cache `parseSession` (latencja przy dużych sesjach).
3. **#5–#9** — ścieżki ASR/TTS/`/btw`, jeśli aktywnie ich używasz.
4. **#17, #18** — sprzątanie + doc, najlepiej jednym przejściem przy refaktorze
   `routes.js`.
5. Reszta wg potrzeb.
