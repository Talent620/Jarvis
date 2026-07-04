#!/usr/bin/env bash
# Jednorazowe, automatyczne wdrożenie backendu JARVIS na Cloudflare Workers.
# Wymaga tylko: Node.js + konto Cloudflare (darmowe). Reszta dzieje się sama.
#
#   bash deploy.sh
#
# Skrypt: zaloguje do Cloudflare (jeśli trzeba), utworzy namespace KV, wstrzyknie
# jego id do wrangler.toml, opcjonalnie ustawi sekrety i wdroży workera.
set -e
cd "$(dirname "$0")"

WRANGLER="npx --yes wrangler@3"

echo "▶ JARVIS BFF — wdrożenie na Cloudflare Workers"
echo

# 1) Logowanie (otworzy przeglądarkę, jeśli nie jesteś zalogowany).
$WRANGLER whoami >/dev/null 2>&1 || $WRANGLER login

# 2) Namespace KV (synchronizacja danych). Tworzymy, jeśli brak id w wrangler.toml.
if grep -q "WSTAW_KV_ID" wrangler.toml; then
  echo "▶ Tworzę namespace KV (JARVIS_KV)…"
  OUT="$($WRANGLER kv namespace create JARVIS_KV 2>&1 || true)"
  echo "$OUT"
  KV_ID="$(printf '%s' "$OUT" | grep -oE 'id = "[a-f0-9]{32}"' | grep -oE '[a-f0-9]{32}' | head -1)"
  if [ -z "$KV_ID" ]; then
    echo "✋ Nie udało się odczytać id KV. Wklej je ręcznie do wrangler.toml (pole id) i uruchom ponownie."
    exit 1
  fi
  # Podmień placeholder na prawdziwe id (działa na Linux i macOS).
  sed -i.bak "s/WSTAW_KV_ID/$KV_ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "✔ KV id ustawione: $KV_ID"
else
  echo "✔ KV id już ustawione w wrangler.toml."
fi

# 3) Sekrety. Ustawiamy tylko te, które podasz w zmiennych środowiskowych przed uruchomieniem,
#    np.:  GEMINI_API_KEY=... TAVILY_API_KEY=... bash deploy.sh
put_secret() {
  local name="$1"; local val="${!1:-}"
  if [ -n "$val" ]; then
    printf '%s' "$val" | $WRANGLER secret put "$name" >/dev/null && echo "✔ Sekret ustawiony: $name"
  fi
}
for S in GEMINI_API_KEY TAVILY_API_KEY ANTHROPIC_API_KEY GROQ_API_KEY \
         OPENROUTER_API_KEY NVIDIA_API_KEY GITHUB_MODELS_TOKEN \
         GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  put_secret "$S"
done
echo "  (Sekrety, których nie podałeś, możesz dodać później: npx wrangler secret put NAZWA)"

# 4) Wdrożenie.
echo "▶ Wdrażam workera…"
$WRANGLER deploy

echo
echo "✅ Gotowe. Skopiuj adres workera powyżej (https://jarvis-bff.<subdomena>.workers.dev)"
echo "   i wpisz go w aplikacji: ⚙ → Backend-proxy oraz ⚙ → Synchronizacja (+ własny token sync)."
echo "   Sprawdź też: otwórz adres w przeglądarce — powinno pokazać {\"ok\":true,...}."
