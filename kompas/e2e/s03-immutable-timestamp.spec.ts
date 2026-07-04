import { test, expect } from "@playwright/test";
import { open, addEntry } from "./helpers";

// S03 — Znacznik czasu nie do podrobienia z UI: żadnej ścieżki edycji
// daty/godziny wpisu; timestamp nadaje system przy zapisie.
test("S03: brak jakiejkolwiek ścieżki edycji znacznika czasu wpisu", async ({ page }) => {
  await open(page);
  await addEntry(page, "Wpis do testu niezmienności czasu.");

  const item = page.getByTestId("entry-item").filter({ hasText: "niezmienności czasu" });
  await expect(item).toBeVisible();

  // Znacznik czasu jest TEKSTEM, nie polem formularza.
  const time = item.getByTestId("entry-time");
  await expect(time).toBeVisible();
  const tag = await time.evaluate((el) => el.tagName.toLowerCase());
  expect(["input", "select", "textarea"]).not.toContain(tag);
  expect(await time.locator("input, select, textarea").count()).toBe(0);

  // Żadnych kontrolek edycji wpisu/czasu w elemencie wpisu.
  expect(await item.locator("[data-testid*='edit']").count()).toBe(0);

  // Kliknięcie w znacznik czasu niczego nie otwiera (nie pojawia się żadne pole).
  await time.click();
  expect(await item.locator("input, select, textarea").count()).toBe(0);
});
