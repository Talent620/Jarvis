import { test, expect } from "@playwright/test";
import { seedWeek, createManualBet } from "./helpers";

// S06 — Bez klucza API: lokalne statystyki oznaczone wprost „bez AI";
// ręczny zakład działa; nic nie udaje analizy AI.
test("S06: bez klucza — uczciwa plakietka i działający zakład ręczny", async ({ page }) => {
  await seedWeek(page);
  await page.getByTestId("nav-week").click();

  // Plakietka uczciwości widoczna, żadnej propozycji „AI".
  await expect(page.getByTestId("local-stats-badge")).toBeVisible();
  await expect(page.getByTestId("local-stats-badge")).toContainText(/bez AI/i);
  expect(await page.getByTestId("ai-proposal").count()).toBe(0);

  // Ręczny zakład działa (helper weryfikuje aktywację na ekranie Zakład).
  await createManualBet(page);
});
