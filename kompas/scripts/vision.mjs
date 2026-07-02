// FAZA 4 — zrzuty ekranów do oceny wizyjnej (EVIDENCE/vision/<runda>/).
// Użycie: node scripts/vision.mjs before|after
// Uruchamia vite preview na porcie 4321, przechodzi przez stany produktu
// (te same ścieżki co e2e) i zapisuje PNG. Rozmiar: 390x844 (telefon).
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const round = process.argv[2] || "before";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "EVIDENCE/vision", round);
mkdirSync(outDir, { recursive: true });

const PORT = 4321;
const BASE = `http://localhost:${PORT}`;

async function waitForServer(url, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* jeszcze nie wstał */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Serwer preview nie wstał w " + ms + " ms");
}

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: root,
  stdio: "ignore",
});
process.on("exit", () => server.kill());

const SEED = [
  { day: "2026-06-29T09:00:00", text: "Poniedziałek rano — plan tygodnia", score: 3 },
  { day: "2026-06-29T20:00:00", text: "Poniedziałek wieczór — zmęczony", score: 3 },
  { day: "2026-06-30T09:30:00", text: "Wtorek — trudna rozmowa z klientem", score: 2 },
  { day: "2026-06-30T21:00:00", text: "Wtorek wieczór — lepiej po spacerze", score: 4 },
  { day: "2026-07-01T08:00:00", text: "Środa — brak snu, wszystko drażni", score: 1 },
  { day: "2026-07-01T19:00:00", text: "Środa wieczór — dobra decyzja o przerwie", score: 5 },
];

try {
  await waitForServer(BASE);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const shot = (name) => page.screenshot({ path: resolve(outDir, name + ".png") });

  // Stub AI (żaden zrzut nie idzie w sieć).
  await page.route("**/api.anthropic.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              bet: "Codziennie 20 minut spaceru przed południem",
              prediction: "Wieczorne oceny wzrosną z 1–3 na 4–5 w ciągu tygodnia",
            }),
          },
        ],
      }),
    })
  );

  // 01 — Dziś, pusto (pierwsze otwarcie).
  await page.clock.install({ time: new Date(SEED[0].day) });
  await page.goto(BASE);
  await page.getByTestId("entry-text").waitFor();
  await shot("01-dzis-pusty");

  // 02 — Tydzień: za mało danych.
  await page.getByTestId("nav-week").click();
  await page.getByTestId("week-too-few").waitFor();
  await shot("02-tydzien-za-malo");

  // Zasiew tygodnia (jak w e2e).
  for (const it of SEED) {
    await page.clock.setFixedTime(new Date(it.day));
    await page.getByTestId("nav-today").click();
    await page.getByTestId("entry-text").fill(it.text);
    await page.getByTestId("entry-score-" + it.score).click();
    await page.getByTestId("entry-save").click();
    await page.getByTestId("entry-list").getByText(it.text).waitFor();
  }

  // 03 — Dziś z wpisami.
  await shot("03-dzis-wpisy");

  // 04 — Tydzień: wzorzec + plakietka „bez AI” (bez klucza).
  await page.getByTestId("nav-week").click();
  await page.getByTestId("week-pattern").waitFor();
  await shot("04-tydzien-wzorzec-bez-ai");

  // 05 — Tydzień: klucz + propozycja AI.
  await page.getByTestId("api-key-input").fill("sk-ant-demo");
  await page.getByTestId("api-key-save").click();
  await page.getByTestId("ai-analyze").click();
  await page.getByTestId("ai-proposal").waitFor();
  await shot("05-tydzien-propozycja-ai");

  // 06 — Zakład: pusto (propozycja nie jest zakładem).
  await page.getByTestId("nav-bet").click();
  await page.getByTestId("bet-empty").waitFor();
  await shot("06-zaklad-pusty");

  // 07 — Zakład aktywny (akceptacja propozycji) + działanie.
  await page.getByTestId("nav-week").click();
  await page.getByTestId("ai-accept").click();
  await page.getByTestId("nav-bet").click();
  await page.getByTestId("bet-active").waitFor();
  await page.getByTestId("action-add").click();
  await page.getByTestId("action-text").fill("Zaplanować spacer w kalendarzu na 11:00");
  await page.getByTestId("action-save").click();
  await shot("07-zaklad-aktywny");

  // 08 — Formularz dowodu (jedyna droga do „zrobione”).
  await page.getByTestId("action-done").click();
  await page.getByTestId("proof-form").waitFor();
  await shot("08-formularz-dowodu");

  // 08b — odmowa bez dowodu.
  await page.getByTestId("proof-submit").click();
  await page.getByTestId("proof-required").waitFor();
  await shot("08b-odmowa-bez-dowodu");

  // 09 — dowód-notatka + podgląd artefaktu.
  await page.getByTestId("proof-type-note").click();
  await page.getByTestId("proof-note-text").fill("Spacer odbyty 11:05–11:30, trasa nad rzeką.");
  await page.getByTestId("proof-submit").click();
  await page.getByTestId("proof-view").click();
  await page.getByTestId("proof-artifact").waitFor();
  await shot("09-artefakt-dowodu");
  await page.keyboard.press("Escape");

  // 10 — panel rozstrzygania.
  await page.getByTestId("bet-resolve").click();
  await page.getByTestId("bet-outcome-hit").waitFor();
  await shot("10-rozstrzyganie");

  // 11 — historia po rozstrzygnięciu.
  await page.getByTestId("bet-outcome-hit").click();
  await page.getByTestId("bet-learned").fill("Blok w kalendarzu działa lepiej niż dobre chęci.");
  await page.getByTestId("bet-resolve-save").click();
  await page.getByTestId("bet-history").waitFor();
  await shot("11-historia-zakladow");

  // 12 — Eksport.
  await page.getByTestId("nav-export").click();
  await page.getByTestId("export-md").waitFor();
  await shot("12-eksport");

  await browser.close();
  console.log("Zrzuty zapisane w", outDir);
} finally {
  server.kill();
}
