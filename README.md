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
  claude-panel:
    image: topnotchprogrammer/claude-panel:latest
    container_name: claude-panel
    pull_policy: always
    working_dir: /app/claude-panel
    volumes:
      - .:/app                                       # twój projekt — Claude może go czytać/edytować
      - ./claude:/home/node/.claude                  # state Claude'a (sesje, OAuth) — przeżywa restart
      - ./claude.json:/home/node/.claude.json        # ustawienia CLI
      - /var/run/docker.sock:/var/run/docker.sock    # Claude może odpalać kontenery hosta (opcjonalne)
      - ./claude-panel:/srv                          # kod panelu (RW dla `node --watch`)
    environment:
      CLAUDE_DIR: /home/node/.claude
      PORT: "8080"
      TMUX_SOCKET: /tmp/cpa-tmux/default
      TMUX_TARGET: cpa-tmux
      UPLOADS_DIR: /app/claude-panel/uploads
      UPLOADS_CLAUDE_PATH: /app/claude-panel/uploads
      PANEL_LANG: pl                                 # język UI: "pl" (default) lub "en"
    ports:
      - "8080:8080"                                  # ⚠️ patrz "Bezpieczeństwo" — bind do localhost jeśli host jest publiczny
    group_add:
      - "998"                                        # gid grupy `docker` na hoście (`getent group docker | cut -d: -f3`)
    stdin_open: true
    tty: true
    restart: unless-stopped
```

```sh
mkdir -p claude && touch claude.json
docker compose up -d
docker exec -it claude-panel cpa-attach   # przyklejenie terminala do tmuxa z claude
```

Panel: <http://localhost:8080>. Pierwsze uruchomienie poprosi o zalogowanie do Claude Code w terminalu (state ląduje w `./claude/`, więc kolejne starty są bez logowania).

Pełny przykład: [`examples/host-project/`](./examples/host-project/).

## Konfiguracja

| Env                     | Default                        | Opis                                                                  |
| ----------------------- | ------------------------------ | --------------------------------------------------------------------- |
| `CLAUDE_DIR`            | `/home/node/.claude`           | gdzie panel czyta JSONL sesji + `.credentials.json`                   |
| `PORT`                  | `8080`                         | port HTTP serwera panelu                                              |
| `TMUX_SOCKET`           | `/tmp/cpa-tmux/default`        | socket tmuxa (panel woła `send-keys` po nim)                          |
| `TMUX_TARGET`           | `cpa-tmux`                     | nazwa sesji tmuxa, do której wysyła `POST /api/send`                  |
| `UPLOADS_DIR`           | `/app/claude-panel/uploads`    | gdzie panel zapisuje wgrane pliki                                     |
| `UPLOADS_CLAUDE_PATH`   | `/app/claude-panel/uploads`    | ścieżka, którą panel **wkleja w prompt** (musi być widoczna z Claude) |
| `PANEL_LANG`            | `pl`                           | język UI: `pl` lub `en` (load-once przy boocie — wymaga recreate)     |
| `CLAUDE_ARGS`           | `--dangerously-skip-permissions` | argumenty przekazane do `claude` przy starcie sesji                  |
| `TTYD_PORT`             | `7681`                         | port ttyd (lokalnie, proxy przez `/terminal`)                         |

Porty:
- `8080` — panel + proxy ttyd pod `/terminal` + WS pod `/api/stream`.

## Bezpieczeństwo

**Nie wystawiaj `:8080` poza localhost / VPN.** Panel **nie ma autoryzacji** — `POST /api/send` wstrzyknie text do tmuxa, czyli do twojej sesji Claude Code. Przykładowy `compose.yml` bind'uje `8080:8080` do wszystkich interfejsów (wygodne lokalnie). Na publicznym hoście zmień na `127.0.0.1:8080:8080` albo schowaj za reverse-proxy z auth.

**Sesja w kontenerze startuje z `--dangerously-skip-permissions`** (Claude Code odpala tooly bez zatwierdzania). To celowy default dla pracy zdalnej z panelu — panel sam moderuje wysyłanie. Jeśli ci to nie pasuje, ustaw `CLAUDE_ARGS=""` (wtedy musisz zatwierdzać każdy tool z terminala).

**Mountowanie `/var/run/docker.sock`** daje Claude'owi dostęp do całego dockera hosta (może odpalać/usuwać dowolne kontenery). Opcjonalne — jeśli twój workflow tego nie potrzebuje, usuń ten mount.

`./claude/` zawiera **OAuth tokeny** (`.credentials.json`) i transkrypty sesji. Trzymaj poza repo (już jest w `.gitignore` tego repo).

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
