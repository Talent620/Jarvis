import { test, expect } from "@playwright/test";
import { open } from "./helpers";

// S12 — Podwójny submit i odświeżenie w trakcie zapisu nie psują danych:
// wpis jest dokładnie raz albo wcale — nigdy w połowie, nigdy podwójnie.
test("S12a: podwójne szybkie kliknięcie „Zapisz” → dokładnie jeden wpis", async ({ page }) => {
  await open(page);
  await page.getByTestId("entry-text").fill("Wpis podatny na dubel");
  await page.getByTestId("entry-score-3").click();
  const save = page.getByTestId("entry-save");
  // Dwa kliknięcia bez czekania na skutek pierwszego.
  await save.click();
  await save.click({ force: true }).catch(() => {
    /* przycisk mógł się już zablokować/zniknąć — to poprawna obrona */
  });

  await expect(page.getByTestId("entry-item").filter({ hasText: "podatny na dubel" })).toHaveCount(1);

  // Po przeładowaniu nadal dokładnie jeden (dubel nie czai się w bazie).
  await page.reload();
  await expect(page.getByTestId("entry-item").filter({ hasText: "podatny na dubel" })).toHaveCount(1);
});

test("S12b: odświeżenie tuż po zapisie → baza spójna (wpis raz albo wcale)", async ({ page }) => {
  await open(page);
  await page.getByTestId("entry-text").fill("Wpis przerwany odświeżeniem");
  await page.getByTestId("entry-score-2").click();
  await page.getByTestId("entry-save").click();
  // Odśwież NATYCHMIAST — bez czekania na potwierdzenie zapisu.
  await page.reload();

  // Aplikacja wstaje bez błędu, lista działa.
  await expect(page.getByTestId("entry-list")).toBeVisible();
  // Wpis jest najwyżej raz — nigdy zduplikowany ani „w połowie" (pusta treść).
  const count = await page.getByTestId("entry-item").filter({ hasText: "przerwany odświeżeniem" }).count();
  expect(count).toBeLessThanOrEqual(1);
  // Żaden wpis nie jest pusty/urwany.
  const all = await page.getByTestId("entry-item").allInnerTexts();
  for (const t of all) expect(t.trim().length).toBeGreaterThan(0);
});
