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
  expect(md).toContain("Wpisy: 1");
});

test("ADV-A2: link „http://” bez hosta NIE domyka działania; pełny URL — tak", async ({ page }) => {
  await seedWeek(page);
  await createManualBet(page);
  await addAction(page, "Działanie na pusty link");

  const item = page.getByTestId("action-item").filter({ hasText: "pusty link" });
  await item.getByTestId("action-done").click();
  await page.getByTestId("proof-type-link").click();
  await page.getByTestId("proof-link-url").fill("http://");
  await page.getByTestId("proof-submit").click();

  // Odmowa z wyjaśnieniem; status bez zmian.
  await expect(page.getByTestId("proof-required")).toBeVisible();
  await expect(item.getByTestId("action-status")).toContainText(/do zrobienia/i);

  // Pełny URL z hostem przechodzi.
  await page.getByTestId("proof-link-url").fill("https://example.com/commit/abc123");
  await page.getByTestId("proof-submit").click();
  await expect(item.getByTestId("action-status")).toContainText(/zrobione/i);
});
