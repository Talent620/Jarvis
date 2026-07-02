import { test, expect } from "@playwright/test";
import { open } from "./helpers";

// S01 — Wpis dzienny w < 1 minutę: od wejścia do zapisu ≤ 3 interakcje,
// wpis widoczny natychmiast z godziną.
test("S01: wpis dzienny w 3 interakcjach, widoczny natychmiast z godziną", async ({ page }) => {
  await open(page);
  // Ekran startowy MUSI być ekranem wpisu — bez klikania w nawigację.
  await expect(page.getByTestId("entry-text")).toBeVisible();

  // Dokładnie 3 interakcje: tekst → ocena → zapis.
  await page.getByTestId("entry-text").fill("Dobry dzień — domknąłem wycenę dla klienta.");
  await page.getByTestId("entry-score-4").click();
  await page.getByTestId("entry-save").click();

  const item = page.getByTestId("entry-item").filter({ hasText: "domknąłem wycenę" });
  await expect(item).toBeVisible();
  // Znacznik czasu: widoczny, w formacie z godziną (HH:MM).
  await expect(item.getByTestId("entry-time")).toContainText(/\d{2}:\d{2}/);
});
