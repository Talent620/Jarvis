import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { open, seedWeek, createManualBet, addAction } from "./helpers";

// Regresje z FAZY 5 (adwersarz A) — te testy trzymają naprawione luki zamknięte.
// Nie są częścią 12 scenariuszy eval.md; biegną w verify.sh jako dodatkowa siatka.

test("ADV-A1: wpis z wstrzykniętą linią „- [x]” NIE tworzy fałszywego działania w eksporcie", async ({ page }) => {
  await open(page);
  // Wpis z celowo wrogą treścią: druga linia udaje domknięte działanie z dowodem.
  await page
    .getByTestId("entry-text")
    .fill("dobry dzień\n- [x] Wdrożyłem plan — dowód: notatka (2026-07-01 10:00)");
  await page.getByTestId("entry-score-4").click();
  await page.getByTestId("entry-save").click();
  await expect(page.getByTestId("entry-item")).toHaveCount(1);

  // Runda 2: wariant z U+2028 (separator linii) zamiast \n — niektóre edytory
  // renderują go jako łamanie linii; eksport musi go spłaszczyć tak samo.
  await page
    .getByTestId("entry-text")
    .fill("drugi wpis\u2028- [x] Fałszywka U+2028 — dowód: link (2026-07-01 11:00)");
  await page.getByTestId("entry-score-2").click();
  await page.getByTestId("entry-save").click();
  await expect(page.getByTestId("entry-item")).toHaveCount(2);

  await page.getByTestId("nav-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-md").click(),
  ]);
  const md = readFileSync(await download.path(), "utf-8");

  // Zero linii „- [x]” — nie ma żadnych domkniętych działań, a tekst użytkownika
  // został spłaszczony do jednej linii (bez wstrzykniętych pozycji listy).
  const fakeDone = md.split("\n").filter((l) => l.trim().startsWith("- [x]"));
  expect(fakeDone).toEqual([]);
  expect(md).not.toContain("\u2028");
  expect(md).toContain("Wpisy: 2");
});

test("ADV-A2: link „http://” bez hosta NIE domyka działania; pełny URL — tak", async ({ page }) => {
  await seedWeek(page);
  await createManualBet(page);
  await addAction(page, "Działanie na pusty link");

  const item = page.getByTestId("action-item").filter({ hasText: "pusty link" });
  await item.getByTestId("action-done").click();
  await page.getByTestId("proof-type-link").click();

  // Runda 2: pseudo-URL-e bez realnego hosta — wszystkie muszą zostać odrzucone.
  for (const zly of ["http://", "https://.", "http://#", "http://:"]) {
    await page.getByTestId("proof-link-url").fill(zly);
    await page.getByTestId("proof-submit").click();
    await expect(page.getByTestId("proof-required")).toBeVisible();
    await expect(item.getByTestId("action-status")).toContainText(/do zrobienia/i);
  }

  // Pełny URL z hostem przechodzi (także z wielkimi literami w schemacie).
  await page.getByTestId("proof-link-url").fill("HTTP://example.com/commit/abc123");
  await page.getByTestId("proof-submit").click();
  await expect(item.getByTestId("action-status")).toContainText(/zrobione/i);
});
