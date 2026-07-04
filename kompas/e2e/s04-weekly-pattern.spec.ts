import { test, expect } from "@playwright/test";
import { open, seedWeek, SEED_WEEK } from "./helpers";

// S04 — Wzorzec tygodniowy z realnych wpisów: liczby zgadzają się z danymi;
// przy za małej próbce system mówi wprost, że danych jest za mało.
test("S04a: za mało wpisów → uczciwy komunikat, żadnego zmyślonego wzorca", async ({ page }) => {
  await open(page);
  await page.getByTestId("nav-week").click();
  await expect(page.getByTestId("week-too-few")).toBeVisible();
  await expect(page.getByTestId("week-too-few")).toContainText(/za mało/i);
  expect(await page.getByTestId("week-pattern").count()).toBe(0);
});

test("S04b: wzorzec z zasianego tygodnia zgadza się z ground truth", async ({ page }) => {
  await seedWeek(page); // 6 wpisów / 3 dni, oceny 3,3,2,4,1,5
  await page.getByTestId("nav-week").click();

  await expect(page.getByTestId("week-pattern")).toBeVisible();
  await expect(page.getByTestId("week-entry-count")).toContainText(String(SEED_WEEK.entries));

  // Rozkład per dzień: 3 dni z wpisami (po 2 wpisy każdy).
  const rows = page.getByTestId("week-day-row");
  const texts = await rows.allInnerTexts();
  const daysWithTwo = texts.filter((t) => /2/.test(t)).length;
  expect(daysWithTwo).toBeGreaterThanOrEqual(SEED_WEEK.days);
});
