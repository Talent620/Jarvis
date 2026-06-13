#!/usr/bin/env node
// === Kreator backendu JARVIS (Cloudflare Workers + Google) ===
// Jedna komenda prowadzi przez całość:  node setup.mjs
// Działa na Windows / macOS / Linux (potrzebny tylko Node.js + konto Cloudflare).
//
// Co robi po kolei:
//  1) loguje do Cloudflare,
//  2) tworzy bazę KV i wpisuje jej id do wrangler.toml,
//  3) wdraża workera, by POZNAĆ jego adres,
//  4) pokazuje DOKŁADNY „redirect URI" do wklejenia w Google Cloud Console
//     i czeka, aż utworzysz dane OAuth (rozwiązuje problem jajko-kura),
//  5) przyjmuje Client ID/Secret (+ opcjonalnie Gemini/Tavily), ustawia sekrety,
//  6) wdraża ponownie i wypisuje gotowy adres + sugerowany token sync.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOML = join(HERE, "wrangler.toml");
const rl = createInterface({ input, output });
const ask = async (q, def = "") => ((await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def);
const c = { b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", cy: "\x1b[36m", r: "\x1b[31m", x: "\x1b[0m" };
const say = (s) => console.log(s);

// Uruchom wrangler. interactive=true → dziedziczy terminal (login/deploy);
// inaczej zwraca przechwycony tekst (do parsowania id/URL).
function wrangler(args, interactive = false) {
  const res = spawnSync("npx", ["--yes", "wrangler@3", ...args], {
    cwd: HERE,
    shell: true, // potrzebne na Windows (npx.cmd)
    stdio: interactive ? "inherit" : ["inherit", "pipe", "pipe"],
    encoding: "utf8",
  });
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  if (!interactive && out.trim()) say(out.trim());
  return { code: res.status ?? 1, out };
}

async function main() {
  say(`\n${c.b}${c.cy}▶ JARVIS — kreator backendu i konta Google${c.x}\n`);
  say("Potrzebujesz: Node.js (masz), darmowe konto Cloudflare i Google.\n");

  // 1) Logowanie do Cloudflare.
  say(`${c.b}[1/6] Logowanie do Cloudflare${c.x}`);
  if (wrangler(["whoami"]).code !== 0) {
    say("Otwieram logowanie w przeglądarce…");
    wrangler(["login"], true);
  } else say(`${c.g}✔ Już zalogowany.${c.x}`);

  // 2) Baza KV (synchronizacja danych).
  say(`\n${c.b}[2/6] Baza danych (KV)${c.x}`);
  let toml = readFileSync(TOML, "utf8");
  if (toml.includes("WSTAW_KV_ID")) {
    const { out } = wrangler(["kv", "namespace", "create", "JARVIS_KV"]);
    const id = (out.match(/[a-f0-9]{32}/) || [])[0];
    if (!id) { say(`${c.r}✋ Nie odczytałem id KV. Wklej je ręcznie do wrangler.toml i uruchom ponownie.${c.x}`); process.exit(1); }
    toml = toml.replace("WSTAW_KV_ID", id);
    writeFileSync(TOML, toml);
    say(`${c.g}✔ Baza KV utworzona (${id}).${c.x}`);
  } else say(`${c.g}✔ Baza KV już skonfigurowana.${c.x}`);

  // 3) Pierwsze wdrożenie — by poznać adres workera.
  say(`\n${c.b}[3/6] Pierwsze wdrożenie (poznajemy adres)${c.x}`);
  const dep = wrangler(["deploy"]);
  if (dep.code !== 0) { say(`${c.r}✋ Wdrożenie nie powiodło się — przewiń wyżej po szczegóły.${c.x}`); process.exit(1); }
  const url = (dep.out.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i) || [])[0];
  if (!url) { say(`${c.y}⚠ Nie odczytałem adresu z logu. Znajdź go powyżej (…workers.dev) i użyj w krokach niżej.${c.x}`); }
  else say(`${c.g}✔ Twój backend działa pod:${c.x} ${c.cy}${url}${c.x}`);

  // 4) Google OAuth — instrukcja z dokładnym redirect URI.
  const redirect = `${url || "https://<twoj-adres>.workers.dev"}/v1/google/callback`;
  say(`\n${c.b}[4/6] Połączenie z Google${c.x}`);
  say("W przeglądarce: https://console.cloud.google.com");
  say("  a) Utwórz/wybierz projekt.");
  say(`  b) Włącz API: ${c.b}Gmail API${c.x} oraz ${c.b}Google Calendar API${c.x}.`);
  say(`  c) Ekran zgody (OAuth): typ „Zewnętrzny" → w „Użytkownicy testowi" dodaj SWÓJ Gmail.`);
  say(`  d) Dane logowania → Utwórz → „Identyfikator klienta OAuth" → typ ${c.b}Aplikacja internetowa${c.x}.`);
  say(`  e) W „Authorized redirect URI" wklej DOKŁADNIE:\n     ${c.cy}${redirect}${c.x}`);
  say("");
  await ask(`${c.y}Gdy to zrobisz, naciśnij Enter, by wpisać Client ID i Secret${c.x}`);

  // 5) Sekrety.
  say(`\n${c.b}[5/6] Zapisuję dane (sekrety — zostają tylko w Twoim Cloudflare)${c.x}`);
  const setSecret = (name, val) => {
    if (!val) return;
    const r = spawnSync("npx", ["--yes", "wrangler@3", "secret", "put", name], { cwd: HERE, shell: true, input: val, encoding: "utf8" });
    say(r.status === 0 ? `${c.g}✔ Zapisano: ${name}${c.x}` : `${c.r}✗ Nie zapisano: ${name}${c.x}`);
  };
  const clientId = await ask("Google Client ID");
  const clientSecret = await ask("Google Client Secret");
  setSecret("GOOGLE_CLIENT_ID", clientId);
  setSecret("GOOGLE_CLIENT_SECRET", clientSecret);
  say(`\n${c.b}(opcjonalnie)${c.x} klucze, jeśli chcesz research/embeddingi przez backend — Enter, by pominąć:`);
  setSecret("GEMINI_API_KEY", await ask("Klucz Gemini (opcjonalnie)"));
  setSecret("TAVILY_API_KEY", await ask("Klucz Tavily (opcjonalnie)"));

  // 6) Ponowne wdrożenie z sekretami.
  say(`\n${c.b}[6/6] Wdrażam ponownie z danymi Google${c.x}`);
  wrangler(["deploy"]);

  const token = randomBytes(12).toString("hex");
  say(`\n${c.g}${c.b}✅ GOTOWE!${c.x}`);
  say(`\nW aplikacji JARVIS wejdź w ⚙ → Integracje i wpisz:`);
  say(`  • ${c.b}Adres backendu sync:${c.x} ${c.cy}${url || "<adres workera z logu wyżej>"}${c.x}`);
  say(`  • ${c.b}Token sync (prywatny):${c.x} ${c.cy}${token}${c.x}   ${c.y}(wygenerowałem losowy — możesz użyć tego)${c.x}`);
  say(`Następnie kliknij ${c.b}🔗 Połącz konto Google${c.x} → zaloguj się (przy ostrzeżeniu: Zaawansowane → Przejdź dalej).`);
  say(`Na końcu: ⚙ → AI → ${c.b}✅ Sprawdź Gmaila${c.x}. Powodzenia!\n`);
  rl.close();
}

main().catch((e) => { say(`${c.r}Błąd: ${e?.message || e}${c.x}`); process.exit(1); });
