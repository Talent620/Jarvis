import { test, expect } from "@playwright/test";
import { open, seedWeek, createManualBet, addAction, closeActionWithNote } from "./helpers";

// S09 — Trzy typy dowodu działają: plik, notatka (timestamp systemowy), link.
// Artefakt da się obejrzeć; plik przetrwa restart.
test("S09: plik, notatka i link jako dowody; plik przeżywa restart", async ({ page, context }) => {
  await seedWeek(page);
  await createManualBet(page);
  await addAction(page, "Działanie A — dowód plik");
  await addAction(page, "Działanie B — dowód notatka");
  await addAction(page, "Działanie C — dowód link");

  // (a) Plik: mały PNG wstrzyknięty z bufora.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const itemA = page.getByTestId("action-item").filter({ hasText: "Działanie A" });
  await itemA.getByTestId("action-done").click();
  await page.getByTestId("proof-type-file").click();
  await page.getByTestId("proof-file-input").setInputFiles({ name: "dowod.png", mimeType: "image/png", buffer: png });
  await page.getByTestId("proof-submit").click();
  await expect(itemA.getByTestId("action-status")).toContainText(/zrobione/i);

  // (b) Notatka: timestamp nadaje system (sprawdzane w widoku artefaktu).
  await closeActionWithNote(page, "Działanie B", "Rozmowa odbyta, ustalenia spisane.");

  // (c) Link.
  const itemC = page.getByTestId("action-item").filter({ hasText: "Działanie C" });
  await itemC.getByTestId("action-done").click();
  await page.getByTestId("proof-type-link").click();
  await page.getByTestId("proof-link-url").fill("https://example.com/commit/abc123");
  await page.getByTestId("proof-submit").click();
  await expect(itemC.getByTestId("action-status")).toContainText(/zrobione/i);

  // Artefakty da się obejrzeć z poziomu działania.
  await itemA.getByTestId("proof-view").click();
  await expect(page.getByTestId("proof-artifact")).toBeVisible();
  await expect(page.getByTestId("proof-artifact")).toContainText(/dowod\.png/);
  await page.keyboard.press("Escape");

  const itemB = page.getByTestId("action-item").filter({ hasText: "Działanie B" });
  await itemB.getByTestId("proof-view").click();
  await expect(page.getByTestId("proof-artifact")).toContainText("ustalenia spisane");
  // Timestamp systemowy widoczny przy artefakcie (tekst, nie pole).
  await expect(page.getByTestId("proof-artifact")).toContainText(/\d{2}:\d{2}/);
  await page.keyboard.press("Escape");

  // Restart: plik (blob) przetrwał.
  await page.close();
  const fresh = await context.newPage();
  await open(fresh);
  await fresh.getByTestId("nav-bet").click();
  const freshA = fresh.getByTestId("action-item").filter({ hasText: "Działanie A" });
  await expect(freshA.getByTestId("action-status")).toContainText(/zrobione/i);
  await freshA.getByTestId("proof-view").click();
  await expect(fresh.getByTestId("proof-artifact")).toContainText(/dowod\.png/);
});
