#!/usr/bin/env bash
# === AI Sales OS — uruchomienie jednym poleceniem ===
# Osobne narzędzie, zintegrowane z JARVIS-em przez token (read-only sync).
# Bootstrapuje wszystko: baza (Docker Postgres) → zależności → schemat → dane
# demo → serwer dev. Po starcie: http://localhost:3000  (login: owner@northstar.studio / demo1234).
#
# Użycie:  bash sales-os/start.sh     (albo z katalogu JARVIS:  npm run salesos)
set -euo pipefail

cd "$(dirname "$0")"
echo "▶ AI Sales OS — start…"

# 1) Baza danych (Postgres przez Docker). Pomijalne, gdy masz własny DATABASE_URL.
if command -v docker >/dev/null 2>&1; then
  echo "▶ Postgres (docker compose up -d db)…"
  docker compose up -d db || echo "⚠ Nie udało się wystartować bazy w Dockerze — upewnij się, że DATABASE_URL wskazuje działającego Postgresa."
else
  echo "⚠ Brak Dockera — ustaw DATABASE_URL w .env na działającego Postgresa."
fi

# 2) Zmienne środowiskowe (z przykładu, jeśli brak).
if [ ! -f .env ]; then
  cp .env.example .env
  # Wygeneruj sekret dla NextAuth, jeśli mamy openssl.
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -base64 32)"
    # Podmień pustą/placeholderową wartość NEXTAUTH_SECRET.
    if grep -q '^NEXTAUTH_SECRET=' .env; then
      sed -i.bak "s|^NEXTAUTH_SECRET=.*|NEXTAUTH_SECRET=${SECRET}|" .env && rm -f .env.bak
    fi
  fi
  echo "▶ Utworzono .env (uzupełnij klucze API w razie potrzeby — warstwa AI działa też bez nich)."
fi

# 3) Zależności.
echo "▶ Instaluję zależności (npm install)…"
npm install

# 4) Schemat + dane demo.
echo "▶ Migracje + seed…"
npm run db:push
npm run db:seed || echo "⚠ Seed pominięty (być może baza już wypełniona)."

# 5) Start serwera dev.
echo "✅ Gotowe. Otwieram http://localhost:3000"
npm run dev
