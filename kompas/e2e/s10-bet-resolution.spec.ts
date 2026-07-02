import { test, expect } from "@playwright/test";
import { seedWeek, createManualBet, addAction, closeActionWithNote } from "./helpers";

// S10 — Rozstrzygnięcie zakładu: wynik vs ORYGINALNE przewidywanie;
// po rozstrzygnięciu zakład w historii, można aktywować następny.
test("S10: rozstrzygnięcie pokazuje oryginalne przewidywanie i otwiera miejsce na następny zakład", async ({ page }) => {
  const PREDICTION = "Wysłanie oferty do środy podniesie szansę domknięcia o połowę";
  await seedWeek(page);
  await createManualBet(page, "Domknę ofertę dla klienta X", PREDICTION);
  await addAction(page, "Wysłać ofertę");
  await closeActionWithNote(page, "Wysłać ofertę", "Oferta wysłana we wtorek o 10:12.");

  // Rozstrzygnięcie: przewidywanie z dnia startu wyświetlone obok werdyktu — niezmienione.
  await page.getByTestId("bet-resolve").click();
  await expect(page.getByTestId("bet-prediction")).toContainText(PREDICTION);
  await page.getByTestId("bet-outcome-hit").click();
  await page.getByTestId("bet-learned").fill("Szybka oferta działa — klient odpisał tego samego dnia.");
  await page.getByTestId("bet-resolve-save").click();

  // Zakład przeszedł do historii; aktywnego brak.
  await expect(page.getByTestId("bet-empty")).toBeVisible();
  await expect(page.getByTestId("bet-history")).toBeVisible();
  const hist = page.getByTestId("bet-history-item").filter({ hasText: "Domknę ofertę" });
  await expect(hist).toBeVisible();
  await expect(hist).toContainText(PREDICTION);
  await expect(hist).toContainText(/sprawdziło się/i);

  // Można aktywować następny.
  await createManualBet(page, "Nowy zakład po rozstrzygnięciu");
});
