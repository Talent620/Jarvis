import { test, expect } from "@playwright/test";
import { seedWeek, createManualBet, stubAnthropic, setApiKey } from "./helpers";

// S07 — Tylko JEDEN aktywny zakład: próba dodania drugiego (ręcznie lub
// przez akceptację AI) jest odrzucana z wyjaśnieniem.
test("S07: drugi zakład ręczny odrzucony z komunikatem", async ({ page }) => {
  await seedWeek(page);
  await createManualBet(page, "Zakład pierwszy — aktywny");

  await page.getByTestId("nav-week").click();
  await page.getByTestId("bet-manual-text").fill("Zakład drugi — ma się nie udać");
  await page.getByTestId("bet-manual-prediction").fill("Nieistotne");
  await page.getByTestId("bet-manual-save").click();

  await expect(page.getByTestId("bet-conflict")).toBeVisible();
  await expect(page.getByTestId("bet-conflict")).toContainText(/rozstrzygnij/i);

  // Aktywny pozostaje dokładnie jeden — ten pierwszy.
  await page.getByTestId("nav-bet").click();
  expect(await page.getByTestId("bet-active").count()).toBe(1);
  await expect(page.getByTestId("bet-text")).toContainText("Zakład pierwszy");
});

test("S07b: akceptacja propozycji AI przy aktywnym zakładzie też odrzucona", async ({ page }) => {
  await stubAnthropic(page);
  await seedWeek(page);
  await createManualBet(page, "Zakład pierwszy — aktywny");
  await setApiKey(page);

  await page.getByTestId("ai-analyze").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  await page.getByTestId("ai-accept").click();

  await expect(page.getByTestId("bet-conflict")).toBeVisible();
  await page.getByTestId("nav-bet").click();
  expect(await page.getByTestId("bet-active").count()).toBe(1);
  await expect(page.getByTestId("bet-text")).toContainText("Zakład pierwszy");
});
