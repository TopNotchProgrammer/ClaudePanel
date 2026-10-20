#!/bin/sh
# HTTPS dla panelu: certyfikat serwera + jednorazowe CA, osobne dla każdego projektu.
#
#   $TLS_DIR (domyślnie ${CLAUDE_DIR}/panel-tls — bind-mount, który projekt i tak ma)
#     cert.pem, key.pem  — cert serwera (825 dni — limit Apple)
#     ca.crt             — CA, które go podpisało; instalacja opcjonalna (np. iOS: bez niej terminal/WebSocket
#                          nie działa), bez niej przeglądarka pokazuje ostrzeżenie, które akceptujesz
#     sans.txt           — SAN-y użyte przy generacji
#
# Klucz CA NIE jest zapisywany — ginie zaraz po podpisaniu certu. Nawet jeśli ktoś (np. prompt injection
# w sesji Claude'a) dobierze się do katalogu, nie wystawi certu dla innej domeny; najwyżej podszyje się
# pod sam panel. Cert jest trwały i przegenerowuje się (razem z nowym CA) tylko przy zmianie SAN-ów
# albo 30 dni przed wygaśnięciem — każda regeneracja = przeglądarka pyta o akceptację od nowa.
# Nic z tego nie jest wypiekane w obraz: obraz jest publiczny.
set -eu

: "${TLS_DIR:=${CLAUDE_DIR:-/home/node/.claude}/panel-tls}"
: "${TLS_HOSTNAMES:=}"

log() { printf '[tls] %s\n' "$*" >&2; }

mkdir -p "$TLS_DIR"
chmod 700 "$TLS_DIR" 2>/dev/null || log "uwaga: nie mogę ustawić 700 na $TLS_DIR"
cd "$TLS_DIR"
rm -rf .gen.* # resztki generacji przerwanej sygnałem (trap EXIT w dashu nie łapie SIGTERM/SIGKILL)

# Stara wersja trzymała klucz CA na dysku — taki klucz uznajemy za spalony: kasujemy i rotujemy CA.
rotate=0
if [ -e ca.key ]; then rm -f ca.key; rotate=1; log "usuwam stary klucz CA z dysku — generuję nowe CA"; fi

# SAN: localhost + loopback + TLS_HOSTNAMES (opcjonalne; przecinki/spacje). Złe wpisy pomijamy z ostrzeżeniem,
# zamiast wywalać całą generację. Lista sortowana — sama zmiana kolejności nie wymusza nowego certu.
is_ipv4() {
  printf '%s\n' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || return 1
  # zera wiodące: przeglądarka czyta 010 ósemkowo (=8), openssl dziesiętnie (=10) — adresy by się rozjechały
  printf '%s\n' "$1" | grep -Eq '(^|\.)0[0-9]' && return 1
  for o in $(printf '%s\n' "$1" | tr '.' ' '); do [ "$o" -le 255 ] || return 1; done
}
# Ścisłe IPv6 (bez osadzonego IPv4): 1–4 hex na grupę, max jedno "::", 8 grup bez "::".
# Luźna wersja przepuszczała "192.168.1.5:8080" → openssl padał → cały panel na HTTP.
is_ipv6() {
  case "$1" in ""|*[!0-9a-f:]*|*:::*|:[!:]*|*[!:]:) return 1 ;; esac
  case "$1" in *:*) ;; *) return 1 ;; esac
  rest=${1#*::}
  if [ "$rest" != "$1" ]; then case "$rest" in *::*) return 1 ;; esac; fi
  n=0
  for g in $(printf '%s\n' "$1" | tr ':' ' '); do [ ${#g} -le 4 ] || return 1; n=$((n + 1)); done
  case "$1" in *::*) [ "$n" -le 7 ] ;; *) [ "$n" -eq 8 ] ;; esac
}
is_dns() {
  # same cyfry i kropki to (zepsute) IP, nie nazwa — 999.1.1.1 / 1.2.3 nie mogą wejść jako DNS:
  printf '%s\n' "$1" | grep -Eq '^[0-9.]+$' && return 1
  printf '%s\n' "$1" | grep -Eq '^(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$' \
    && [ "${#1}" -le 253 ]
}

set -f # TLS_HOSTNAMES="*" nie może rozwinąć się do nazw plików z katalogu z kluczami
entries="DNS:localhost
IP:127.0.0.1
IP:::1"
for h in $(printf '%s\n' "$TLS_HOSTNAMES" | tr ',' ' '); do
  h=$(printf '%s\n' "$h" | sed 's/^\[\(.*\)\]$/\1/; s/%.*$//' | tr 'A-Z' 'a-z')
  if is_ipv4 "$h" || is_ipv6 "$h"; then entries="$entries
IP:$h"
  elif is_dns "$h"; then entries="$entries
DNS:$h"
  else log "pomijam niepoprawny wpis w TLS_HOSTNAMES: '$h'"
  fi
done
set +f
SANS=$(printf '%s\n' "$entries" | sort -u | paste -sd, -)

need=$rotate
[ -s cert.pem ] && [ -s key.pem ] && [ -s ca.crt ] || need=1
[ "$(cat sans.txt 2>/dev/null)" = "$SANS" ] || need=1
openssl x509 -in cert.pem -noout -checkend 2592000 >/dev/null 2>&1 || need=1
openssl verify -CAfile ca.crt cert.pem >/dev/null 2>&1 || need=1
# para po przerwanej generacji / ręcznej podmianie: klucz musi pasować do certu
[ "$(openssl x509 -in cert.pem -noout -pubkey 2>/dev/null)" = "$(openssl pkey -in key.pem -pubout 2>/dev/null)" ] || need=1

if [ "$need" = 0 ]; then exit 0; fi

log "generuję certyfikat ($SANS)"
# Wszystko w katalogu tymczasowym obok (ten sam FS → mv atomowe); podmiana dopiero po pełnym sukcesie.
# Przerwanie między mv zostawi co najwyżej niepasującą parę, którą powyższy check złapie na następnym boocie.
tmp=$(mktemp -d "$TLS_DIR/.gen.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
err="$tmp/openssl.log"
# Generacja padła, ale na dysku jest wciąż poprawna para (np. tylko dopisany host był zły / brak entropii)?
# Zostajemy przy starej zamiast spadać na HTTP.
fail() {
  log "błąd openssl: $(cat "$err" 2>/dev/null)"
  if [ "$rotate" = 0 ] && openssl verify -CAfile ca.crt cert.pem >/dev/null 2>&1 \
     && [ "$(openssl x509 -in cert.pem -noout -pubkey 2>/dev/null)" = "$(openssl pkey -in key.pem -pubout 2>/dev/null)" ]; then
    log "zostaję przy dotychczasowym certyfikacie"
    exit 0
  fi
  exit 1
}

stamp=$(date -u +%Y-%m-%d)
openssl req -x509 -new -nodes -newkey rsa:2048 -sha256 -days 900 \
  -keyout "$tmp/ca.key" -out "$tmp/ca.crt" \
  -subj "/CN=claude-panel local CA ($stamp)" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" >/dev/null 2>"$err" || fail
printf '%s\n' \
  "basicConstraints=critical,CA:FALSE" \
  "keyUsage=critical,digitalSignature,keyEncipherment" \
  "extendedKeyUsage=serverAuth" \
  "subjectAltName=$SANS" > "$tmp/ext"
openssl req -new -nodes -newkey rsa:2048 -sha256 \
  -keyout "$tmp/key.pem" -out "$tmp/cert.csr" -subj "/CN=claude-panel" >/dev/null 2>"$err" || fail
openssl x509 -req -in "$tmp/cert.csr" -CA "$tmp/ca.crt" -CAkey "$tmp/ca.key" \
  -set_serial "0x$(openssl rand -hex 16)" -sha256 -days 825 -extfile "$tmp/ext" \
  -out "$tmp/cert.pem" >/dev/null 2>"$err" || fail
rm -f "$tmp/ca.key" # klucz CA żyje tylko na czas podpisu
chmod 600 "$tmp/key.pem"

mv "$tmp/key.pem" key.pem
mv "$tmp/cert.pem" cert.pem
mv "$tmp/ca.crt" ca.crt
printf '%s\n' "$SANS" > sans.txt
log "SHA-256 CA: $(openssl x509 -in ca.crt -noout -fingerprint -sha256 | cut -d= -f2)"
