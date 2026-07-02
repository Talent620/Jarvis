import { test, expect } from "@playwright/test";
import { seedWeek, createManualBet, addAction } from "./helpers";

// S08 — Działanie można domknąć TYLKO z dowodem. Zasada zerowa produktu:
// stan „done" istnieje wyłącznie z artefaktem dowodowym.
test("S08: próba domknięcia bez dowodu → odmowa z wyjaśnieniem, status bez zmian", async ({ page }) => {
  await seedWeek(page);
  await createManualBet(page);
  await addAction(page, "Wysłać ofertę do klienta X");

  const item = page.getByTestId("action-item").filter({ hasText: "Wysłać ofertę" });
  await expect(item.getByTestId("action-status")).toContainText(/do zrobienia/i);

  // Jedyna droga do „zrobione" prowadzi przez formularz dowodu.
  await item.getByTestId("action-done").click();
  await expect(page.getByTestId("proof-form")).toBeVisible();

  // Próba zatwierdzenia BEZ dowodu → odmowa + wyjaśnienie dlaczego.
  await page.getByTestId("proof-submit").click();
  await expect(page.getByTestId("proof-required")).toBeVisible();
  await expect(page.getByTestId("proof-required")).toContainText(/dowod/i);

  // Status działania NIE zmienił się.
  await expect(item.getByTestId("action-status")).toContainText(/do zrobienia/i);

  // Poza formularzem dowodu nie istnieje żadna kontrolka ustawiająca „zrobione".
  expect(await item.locator("input[type='checkbox']").count()).toBe(0);
});
