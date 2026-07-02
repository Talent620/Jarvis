import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedWeek, SEED_WEEK, createManualBet, addAction, closeActionWithNote } from "./helpers";

// S11 — Eksport markdown odzwierciedla prawdę: działanie bez dowodu NIGDY
// nie figuruje jako zrobione; liczby w eksporcie = liczby w bazie.
test("S11: eksport .md zgadza się z zasianym ground truth i nie kłamie o dowodach", async ({ page }) => {
  await seedWeek(page); // 6 wpisów / 3 dni
  await createManualBet(page, "Zakład eksportowy", "Przewidywanie eksportowe");
  await addAction(page, "Działanie domknięte z dowodem");
  await addAction(page, "Działanie otwarte bez dowodu");
  await closeActionWithNote(page, "Działanie domknięte", "Potwierdzenie wykonania — notatka.");

  await page.getByTestId("nav-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-md").click(),
  ]);
  const path = await download.path();
  const md = readFileSync(path, "utf-8");

  // Liczby zgadzają się z bazą (ground truth z helpers).
  expect(md).toContain(`Wpisy: ${SEED_WEEK.entries}`);
  for (const it of SEED_WEEK.items) expect(md).toContain(it.text);

  // Zakład i przewidywanie obecne.
  expect(md).toContain("Zakład eksportowy");
  expect(md).toContain("Przewidywanie eksportowe");

  // Zasada zerowa w eksporcie: każda linia „zrobione" ma dowód; otwarte działanie
  // nie jest oznaczone jako zrobione.
  const doneLines = md.split("\n").filter((l) => l.includes("[x]"));
  expect(doneLines.length).toBe(1);
  for (const l of doneLines) expect(l).toMatch(/dowód/);
  const openLine = md.split("\n").find((l) => l.includes("Działanie otwarte bez dowodu"));
  expect(openLine).toBeTruthy();
  expect(openLine!).toContain("[ ]");
});
