// JARVIS — krok "build" warstwy webowej.
//
// UWAGA: źródło frontendu (React/Vite) NIE znajduje się w tym repozytorium —
// jest tu wyłącznie skompilowana aplikacja webowa zapakowana w gotowy plik APK
// (czyli dokładnie ten sam frontend, który działa na Androidzie).
//
// Dodatkowo katalog `dist/` NIE jest wersjonowany w gicie, bo skompilowany bundle
// zawiera zaszyty klucz API (patrz README → Bezpieczeństwo). Dlatego ten skrypt
// odtwarza `dist/` z pliku APK przy każdym buildzie i nie kompiluje Reacta od nowa.
//
// Jeśli dodasz właściwe źródło (React/Vite), podmień ten skrypt na np. `vite build`
// i ustaw `webDir` w capacitor.config.json na katalog wyjściowy (zwykle `dist`).

import { existsSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const cwd = process.cwd();
const distIndex = resolve(cwd, "dist/index.html");

function materializeFromApk() {
  const apk = readdirSync(cwd).find((f) => f.toLowerCase().endsWith(".apk"));
  if (!apk) {
    console.error("✗ Brak dist/ oraz brak pliku .apk, z którego można odtworzyć frontend.");
    process.exit(1);
  }
  console.log(`• Odtwarzam dist/ z pakietu: ${apk}`);
  const tmp = resolve(cwd, ".apk_extract");
  rmSync(tmp, { recursive: true, force: true });
  rmSync(resolve(cwd, "dist"), { recursive: true, force: true });
  mkdirSync(resolve(cwd, "dist"), { recursive: true });
  execFileSync("unzip", ["-qo", apk, "assets/public/*", "-d", tmp], { stdio: "inherit" });
  cpSync(resolve(tmp, "assets/public"), resolve(cwd, "dist"), { recursive: true });
  rmSync(tmp, { recursive: true, force: true });
}

if (!existsSync(distIndex)) {
  materializeFromApk();
}

if (!existsSync(distIndex)) {
  console.error("✗ Nie udało się przygotować dist/index.html.");
  process.exit(1);
}

console.log("✓ JARVIS: warstwa webowa gotowa w dist/ (frontend bez zmian).");
