import { test, expect } from "@playwright/test";
import { seedWeek, stubAnthropic, setApiKey, AI_PROPOSAL } from "./helpers";

// S05 — Analiza AI: JEDNA propozycja zakładu z przewidywaniem; nic nie
// aktywuje się bez ludzkiej akceptacji.
test("S05: propozycja AI wymaga akceptacji człowieka; po akceptacji zakład aktywny", async ({ page }) => {
  await stubAnthropic(page);
  await seedWeek(page);
  await setApiKey(page);

  await page.getByTestId("ai-analyze").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  await expect(page.getByTestId("ai-proposal-text")).toContainText(AI_PROPOSAL.bet);
  await expect(page.getByTestId("ai-proposal-prediction")).toContainText(AI_PROPOSAL.prediction);

  // Propozycja NIE jest zakładem: ekran Zakład wciąż pusty.
  await page.getByTestId("nav-bet").click();
  await expect(page.getByTestId("bet-empty")).toBeVisible();
  expect(await page.getByTestId("bet-active").count()).toBe(0);

  // Akceptacja → dopiero teraz zakład aktywny.
  await page.getByTestId("nav-week").click();
  await page.getByTestId("ai-accept").click();
  await page.getByTestId("nav-bet").click();
  await expect(page.getByTestId("bet-active")).toBeVisible();
  await expect(page.getByTestId("bet-text")).toContainText(AI_PROPOSAL.bet);
});

test("S05b: odrzucenie propozycji nie zostawia śladu w zakładach", async ({ page }) => {
  await stubAnthropic(page);
  await seedWeek(page);
  await setApiKey(page);

  await page.getByTestId("ai-analyze").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  await page.getByTestId("ai-reject").click();

  await page.getByTestId("nav-bet").click();
  await expect(page.getByTestId("bet-empty")).toBeVisible();
});
