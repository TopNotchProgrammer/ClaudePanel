# claude-panel

Przeglądarkowy panel do **monitorowania i sterowania sesją [Claude Code](https://docs.claude.com/claude-code)**. Obraz Docker zawiera w sobie Claude Code CLI, tmux, ttyd i serwer panelu — uruchamiasz jeden kontener, dostajesz:

- transkrypt sesji w przeglądarce z live-tail (SSE),
- pasek wykorzystania subskrypcji 5h / 7d,
- wbudowany terminal (ttyd → tmux attach) pod `/terminal`,
- input do wysyłania wiadomości i plików (z server-side kolejką, parowaną z aktywnym turnem),
- przycisk Esc (przerwanie tury) i `/btw` overlay.

## Quick start

```yaml
# compose.yml — w roocie repo, w którym chcesz uruchomić Claude Code
services:
  docker-proxy:
    container_name: docker-proxy
    image: wollomatic/socket-proxy:1
    read_only: true
    mem_limit: 64M
    cap_drop:
      - ALL
    user: ":998" # gid grupy `docker` na hoście (`getent group docker | cut -d: -f3`)
    security_opt:
      - no-new-privileges
    command:
      - "-listenip=0.0.0.0"
      - "-allowfrom=0.0.0.0/0"
      - "-loglevel=info"
      - '-allowGET=/v\d+\.\d+/(containers|exec)/.*'
      - '-allowPOST=/v\d+\.\d+/containers/(container1|container2)/exec' # container1|container2 - zamien na liste kontenerow do ktorych claude ma miec dostep (exec)
      - '-allowPOST=/v\d+\.\d+/exec/[a-f0-9]+/start'
      - '-allowPOST=/v\d+\.\d+/exec/[a-f0-9]+/resize'
      - "-allowhealthcheck"
    healthcheck:
      test: ["CMD", "./healthcheck"]
      interval: 30s
      timeout: 5s
      retries: 3
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: unless-stopped
  claude-panel:
    DOCKER_HOST: tcp://docker-proxy:2375
    image: topnotchprogrammer/claude-panel:latest
    container_name: claude-panel
    pull_policy: always
    volumes:
      - .:/app # twój projekt — Claude może go czytać/edytować
      - ./claude:/home/node/.claude # state Claude'a (sesje, OAuth) — przeżywa restart
      - ./claude.json:/home/node/.claude.json # ustawienia CLI
    environment:
      CLAUDE_DIR: /home/node/.claude
      PORT: "8080"
      TMUX_SOCKET: /tmp/cpa-tmux/default
      TMUX_TARGET: cpa-tmux
      PANEL_LANG: pl # język UI: "pl" (default) lub "en"
      PANEL_PASSWORD: ${PANEL_PASSWORD} # wymagane — hasło w .env obok: PANEL_PASSWORD='twoje-haslo' (patrz "Bezpieczeństwo")
      # TLS_HOSTNAMES: "192.168.1.10" # dodatkowe IP/hosty w certyfikacie (dostęp z LAN), po przecinku
    ports:
      - "8080:8080" # ⚠️ patrz "Bezpieczeństwo" — bind do localhost jeśli host jest publiczny
    stdin_open: true
    tty: true
    restart: unless-stopped
```

```sh
mkdir -p claude && touch claude.json
echo "PANEL_PASSWORD='$(openssl rand -base64 18)'" >> .env   # hasło do panelu (zapisz je sobie)
docker compose up -d
docker exec -it claude-panel cpa-attach   # przyklejenie terminala do tmuxa z claude
```

Panel: <https://localhost:8080> (HTTPS, przy pierwszym wejściu zaakceptuj ostrzeżenie — patrz [HTTPS](#https)). Pierwsze uruchomienie poprosi o zalogowanie do Claude Code w terminalu (state ląduje w `./claude/`, więc kolejne starty są bez logowania).

## Konfiguracja

| Env                   | Default                          | Opis                                                                  |
| --------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `CLAUDE_DIR`          | `/home/node/.claude`             | gdzie panel czyta JSONL sesji + `.credentials.json`                   |
| `PORT`                | `8080`                           | port HTTP serwera panelu                                              |
| `TMUX_SOCKET`         | `/tmp/cpa-tmux/default`          | socket tmuxa (panel woła `send-keys` po nim)                          |
| `TMUX_TARGET`         | `cpa-tmux`                       | nazwa sesji tmuxa, do której wysyła `POST /api/send`                  |
| `UPLOADS_DIR`         | `/tmp/claude-panel-uploads`      | gdzie panel zapisuje wgrane pliki                                     |
| `UPLOADS_CLAUDE_PATH` | = `UPLOADS_DIR`                  | ścieżka, którą panel **wkleja w prompt** (musi być widoczna z Claude) |
| `PANEL_PASSWORD`      | — (**wymagane**)                 | hasło do panelu; bez niego panel pokazuje tylko stronę z instrukcją   |
| `PANEL_AUTH`          | —                                | `off` = świadomie bez hasła (panel za własnym auth: proxy, VPN)       |
| `PANEL_LANG`          | `pl`                             | język UI: `pl` lub `en` (load-once przy boocie — wymaga recreate)     |
| `CLAUDE_ARGS`         | `--dangerously-skip-permissions` | argumenty przekazane do `claude` przy starcie sesji                   |
| `TTYD_PORT`           | `7681`                           | port ttyd (lokalnie, proxy przez `/terminal`)                         |
| `TLS`                 | `auto`                           | `auto` = HTTPS z certem per projekt, `off`/`false`/`0`/`no` = HTTP    |
| `TLS_HOSTNAMES`       | —                                | dodatkowe SAN-y certu (IP/hosty z LAN), po przecinku                  |
| `TLS_DIR`             | `${CLAUDE_DIR}/panel-tls`        | gdzie leży CA + cert projektu                                         |
| `TLS_CERT`/`TLS_KEY`  | —                                | własny cert + klucz (PEM) — pomija generowanie                        |

Porty:

- `8080` — panel (HTTPS, a goły HTTP → redirect 307) + proxy ttyd pod `/terminal` + SSE pod `/api/stream`.

## HTTPS

Panel domyślnie chodzi po **HTTPS** na tym samym porcie (`https://localhost:8080`). Wejście przez `http://` dostaje redirect 307 na `https://`. **Nie trzeba nic dopisywać do `compose.yml`.**

- Przy pierwszym starcie kontener generuje certyfikat w `./claude/panel-tls/`, czyli w katalogu, który i tak montujesz. Każdy projekt ma własny, nic nie jest współdzielone.
- Cert jest trwały: przeżywa aktualizacje obrazu i recreate kontenera. Przeglądarka pokaże ostrzeżenie („połączenie nie jest prywatne”), które akceptujesz. Cert przegeneruje się tylko przy zmianie `TLS_HOSTNAMES` albo po ~2 latach.
- Jak długo przeglądarka pamięta akceptację:
  - **Chrome** ok. 7 dni, potem trzeba kliknąć ponownie;
  - **Firefox** na stałe, ale ma jeden wpis na `host:port`, więc przełączenie na inny projekt pod tym samym `localhost:8080` (inny cert) każe akceptować od nowa.
- **iPhone/iPad:** sam panel działa po zaakceptowaniu ostrzeżenia, ale **terminal (`/terminal/`) nie**. WebSocket w Safari ignoruje zaakceptowane wyjątki. Żeby terminal działał na iOS, zainstaluj CA projektu: otwórz `https://<host>:8080/ca.crt`, zainstaluj profil, potem *Ustawienia → Ogólne → To urządzenie → Ustawienia zaufania certyfikatów* → włącz.
- Cert obejmuje `localhost`, `127.0.0.1` i `::1`. Po IP z LAN albo przez domenę też wystarczy zaakceptować ostrzeżenie. `TLS_HOSTNAMES` dopisz tylko wtedy, gdy instalujesz CA albo chcesz, żeby nazwa w cercie się zgadzała.
- **Klucz CA nie jest przechowywany.** Ginie zaraz po podpisaniu certu, więc nawet zainstalowane CA nie pozwoli nikomu wystawić certu dla innej domeny. Odcisk SHA-256 CA jest w `docker logs` (`[tls] SHA-256 CA: …`). `/ca.crt` jest dostępne tylko po HTTPS. Nic z tego nie jest w obrazie.
- **Reverse proxy / tunel** (Traefik, nginx, Cloudflare Tunnel) łączący się z `http://…:8080`: requesty z nagłówkiem `X-Forwarded-*` / `Forwarded` są obsługiwane normalnie, bez redirectu (żadnej pętli). Jeśli twoje proxy nie wysyła tych nagłówków, skieruj je na `https://…:8080` (z wyłączoną weryfikacją certu upstreamu) albo ustaw `TLS=off`.
- Healthchecki na `http://…/healthz` działają bez zmian. Karta otwarta jeszcze po HTTP przeładuje się sama. Gdy panel straci połączenie (np. inny cert), pokaże „utracono połączenie — odśwież stronę”.

Własny certyfikat (np. Let's Encrypt dla twojej domeny): zamontuj pliki i ustaw `TLS_CERT` + `TLS_KEY`. Wtedy nic się nie generuje i ostrzeżeń nie ma. `TLS=off` (albo `false`/`0`/`no`) wyłącza HTTPS.

## Bezpieczeństwo

**Hasło do panelu (`PANEL_PASSWORD`) jest wymagane.** Bez niego panel nie wpuszcza nikogo, tylko pokazuje stronę z instrukcją, jak je ustawić. Po zalogowaniu przeglądarka dostaje cookie sesji (HttpOnly, SameSite=Lax, Secure po HTTPS) ważne 30 dni. Zmiana hasła unieważnia wszystkie sesje.

- **Co jest chronione:** wszystko. UI, REST (`/api/*`), strumień SSE (`/api/stream`), strona terminala i WebSocket terminala (`/terminal/ws`). Bez logowania dostępne są tylko `/healthz` i publiczny cert `/ca.crt`.
- **CSRF:** requesty zmieniające stan (POST) i WebSocket muszą przyjść z tego samego originu (`Origin` / `Sec-Fetch-Site`). Strona na innym porcie tego samego hosta ani z subdomeny nie wyśle nic do Claude'a.
- **Wylogowanie** (ikona w pasku, z potwierdzeniem) unieważnia tę sesję po stronie serwera i od razu zamyka jej otwarte połączenia, także terminal. Inne urządzenia zostają zalogowane.
- **Wiele projektów na jednym hoście:** każdy ma własne cookie (nazwa zależna od instalacji), więc się nie wylogowują nawzajem.
- **Brute force:** po 5 nieudanych próbach z jednego adresu (IPv6 po /64) logowanie jest blokowane na 30 s. Blokada podwaja się przy każdej kolejnej próbie, maksymalnie do 15 min. Za reverse proxy wszyscy mają adres proxy, więc blokada jest wspólna. Przy haśle krótszym niż 12 znaków w logu pojawia się ostrzeżenie.
- **Gdzie trzymać hasło:** nie w repo. W compose wpisz `PANEL_PASSWORD: ${PANEL_PASSWORD}`, a hasło w `.env` obok `compose.yml`, w **pojedynczych cudzysłowach**: `PANEL_PASSWORD='p@ss#$x'`. Bez nich `$` i `#` są interpretowane. Jeśli wpisujesz hasło wprost w `compose.yml`, `$` zapisuj jako `$$`. Sam `.env` nie trafia do kontenera, potrzebne jest odwołanie `${PANEL_PASSWORD}` w `environment:`.
- **Pliki w `./claude/`:** `panel-auth.key` (sekret podpisujący cookie), `panel-auth.revoked` (wylogowane sesje) i `panel-tls/`. Katalog musi być w `.gitignore`.
- **Granica ochrony:** hasło chroni panel przed siecią, nie przed sesją Claude'a w kontenerze. Claude widzi `compose.yml`/`.env` w projekcie i zmienne środowiskowe procesów.
- **Panel za własnym uwierzytelnianiem** (reverse proxy z auth, VPN)? Ustaw `PANEL_AUTH: "off"`. Ochrona CSRF zostaje.

**Mimo hasła nie wystawiaj `:8080` do internetu.** Panel daje pełną kontrolę nad sesją Claude Code i shellem w kontenerze. Trzymaj go w LAN / VPN. Na publicznym hoście zmień mapowanie na `127.0.0.1:8080:8080` albo schowaj go za reverse proxy.

## Aktualizacja do wersji z HTTPS i hasłem

Po `docker compose pull && docker compose up -d`:

1. **Ustaw hasło.** Bez `PANEL_PASSWORD` panel pokaże tylko stronę z instrukcją, a `/api/*` zwróci 503. Dopisz `PANEL_PASSWORD: ${PANEL_PASSWORD}` do `environment:` i hasło do `.env`, potem `docker compose up -d`.
2. **HTTPS.** Zakładki `http://…:8080` przekierują na `https://`. Przy pierwszym wejściu zaakceptuj ostrzeżenie o certyfikacie (szczegóły w sekcji [HTTPS](#https)).
3. **Reverse proxy** (Traefik, Caddy, cloudflared, NPM): działa bez zmian, bo requesty z `X-Forwarded-*` nie są przekierowywane. Dla nginx dodaj `proxy_set_header Host $host;` (albo `X-Forwarded-Host`), żeby przechodził test `Origin` dla terminala. Możesz też kierować proxy na `https://…:8080`.
4. **Monitoring:** `http://…/healthz` dalej zwraca 200. Healthcheck w compose (w obrazie nie ma curl):
   `test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]`
5. **Własny certyfikat** (`TLS_CERT`/`TLS_KEY`, np. Let's Encrypt): pliki muszą być czytelne dla uid 1000. `privkey.pem` należący do roota z trybem 600 nie przejdzie, a panel wstanie wtedy na HTTP (komunikat w logu).

## Architektura w skrócie

Jeden kontener, w środku:

- `tmux` z sesją `cpa-tmux` w której biega `claude` (CLI),
- `ttyd` na `127.0.0.1:7681` przyklejony do tej sesji (proxy z panelu pod `/terminal`),
- Node HTTP serwer z `node --watch` (panel + API + SSE + WS upgrade do ttyd).

Panel czyta sesje z `${CLAUDE_DIR}/projects/<project>/<sessionId>.jsonl` (live-tail przez `fs.watch`), wysyła wiadomości przez `tmux send-keys`, pokazuje wykorzystanie subskrypcji z `https://api.anthropic.com/api/oauth/usage`.

## Rozwój

Repo zawiera własny harness deweloperski (`compose.yml` + `start.sh` w roocie) — `./start.sh` zbuduje obraz lokalnie i wystartuje go z bind-mountem `claude-panel/` jako `/srv` (RW), więc edycje w `claude-panel/src/**` triggerują `node --watch` bez rebuildu.

Pełna dokumentacja architektury, HTTP API i gotchas: [`CLAUDE.md`](./CLAUDE.md).

Release: push taga `v*` → CircleCI buduje multi-arch (`linux/amd64,linux/arm64`) i pushuje do Docker Hub jako `<dockerhub-user>/claude-panel`. Szczegóły konfiguracji CI: sekcja "Release / CI" w `CLAUDE.md`.
