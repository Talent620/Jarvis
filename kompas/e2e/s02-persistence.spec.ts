import { test, expect } from "@playwright/test";
import { open, addEntry } from "./helpers";

// S02 — Wpis przetrwa restart: zamknięcie karty i ponowne otwarcie
// nie zmienia treści ani znacznika czasu.
test("S02: wpis przeżywa zamknięcie karty (ta sama treść i czas)", async ({ page, context }) => {
  await open(page);
  await addEntry(page, "Wpis do testu trwałości — nie zgub mnie.");
  const timeBefore = await page
    .getByTestId("entry-item")
    .filter({ hasText: "nie zgub mnie" })
    .getByTestId("entry-time")
    .innerText();

  // „Zamykam kartę całkowicie": nowa karta w tym samym profilu (IndexedDB zostaje).
  await page.close();
  const fresh = await context.newPage();
  await open(fresh);

  const item = fresh.getByTestId("entry-item").filter({ hasText: "nie zgub mnie" });
  await expect(item).toBeVisible();
  await expect(item.getByTestId("entry-time")).toHaveText(timeBefore);
});
