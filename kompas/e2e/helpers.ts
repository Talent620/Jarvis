import { expect, type Page } from "@playwright/test";

// ============================================================================
// KONTRAKT UI — te data-testid są umową między harnessem a produktem (PLAN.md).
// Zmiana nazwy testid = zmiana kontraktu = wpis w DECISIONS.md.
// ============================================================================
// Nawigacja (4 ekrany): nav-today, nav-week, nav-bet, nav-export
// Dziś:      entry-text, entry-score-1..5, entry-save, entry-list, entry-item,
//            entry-time (w środku entry-item, tekst — nigdy pole edycji)
// Tydzień:   week-too-few | week-pattern (z week-entry-count, week-day-row×7),
//            api-key-input, api-key-save, ai-analyze, ai-proposal (ai-proposal-text,
//            ai-proposal-prediction, ai-accept, ai-reject), local-stats-badge,
//            bet-manual-text, bet-manual-prediction, bet-manual-save, bet-conflict
// Zakład:    bet-empty | bet-active (bet-text, bet-prediction, bet-status),
//            action-add, action-text, action-save, action-item (action-status,
//            action-done, proof-view), proof-form (proof-type-note, proof-type-link,
//            proof-type-file, proof-note-text, proof-link-url, proof-file-input,
//            proof-submit, proof-required), proof-artifact, bet-resolve,
//            bet-outcome-hit, bet-outcome-miss, bet-outcome-unclear, bet-learned,
//            bet-resolve-save, bet-history, bet-history-item
// Eksport:   export-md (przycisk pobrania pliku .md)
// ============================================================================

/** Otwórz aplikację (ekran startowy = Dziś). */
export async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("app-title")).toBeVisible();
}

/** Dodaj wpis dzienny: DOKŁADNIE 3 interakcje (tekst, ocena, zapis) — kryterium S01. */
export async function addEntry(page: Page, text: string, score = 3): Promise<void> {
  await page.getByTestId("entry-text").fill(text);
  await page.getByTestId("entry-score-" + score).click();
  await page.getByTestId("entry-save").click();
  await expect(page.getByTestId("entry-list")).toContainText(text);
}

/** Zainstaluj sterowany zegar PRZED wejściem na stronę (testy wielodniowe). */
export async function installClock(page: Page, isoStart: string): Promise<void> {
  await page.clock.install({ time: new Date(isoStart) });
}

/**
 * Zasiej tydzień: 6 wpisów w 3 różnych dniach (2+2+2), znane oceny.
 * Ground truth dla S04/S11: dni=3, wpisy=6, suma ocen=18 (3+3+2+4+1+5).
 */
export const SEED_WEEK = {
  days: 3,
  entries: 6,
  items: [
    { day: "2026-06-29T09:00:00", text: "Poniedziałek rano — plan tygodnia", score: 3 },
    { day: "2026-06-29T20:00:00", text: "Poniedziałek wieczór — zmęczony", score: 3 },
    { day: "2026-06-30T09:30:00", text: "Wtorek — trudna rozmowa z klientem", score: 2 },
    { day: "2026-06-30T21:00:00", text: "Wtorek wieczór — lepiej po spacerze", score: 4 },
    { day: "2026-07-01T08:00:00", text: "Środa — brak snu, wszystko drażni", score: 1 },
    { day: "2026-07-01T19:00:00", text: "Środa wieczór — dobra decyzja o przerwie", score: 5 },
  ],
} as const;

export async function seedWeek(page: Page): Promise<void> {
  await installClock(page, SEED_WEEK.items[0].day);
  await open(page);
  for (const it of SEED_WEEK.items) {
    await page.clock.setFixedTime(new Date(it.day));
    await page.getByTestId("nav-today").click();
    await addEntry(page, it.text, it.score);
  }
}

/** Deterministyczny stub Anthropic API — testy NIGDY nie idą w sieć. */
export const AI_PROPOSAL = {
  bet: "Codziennie 20 minut spaceru przed południem",
  prediction: "Wieczorne oceny wzrosną z 1–3 na 4–5 w ciągu tygodnia",
} as const;

export async function stubAnthropic(page: Page): Promise<void> {
  await page.route("**/api.anthropic.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text: JSON.stringify(AI_PROPOSAL) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    })
  );
}

/** Ustaw klucz API w UI (ekran Tydzień). */
export async function setApiKey(page: Page, key = "sk-ant-test-stub"): Promise<void> {
  await page.getByTestId("nav-week").click();
  await page.getByTestId("api-key-input").fill(key);
  await page.getByTestId("api-key-save").click();
}

/** Utwórz ręczny zakład (ekran Tydzień) i zweryfikuj aktywację. */
export async function createManualBet(
  page: Page,
  bet = "Zamknę ofertę dla klienta X do piątku",
  prediction = "Wysłanie oferty do środy podniesie szansę domknięcia"
): Promise<void> {
  await page.getByTestId("nav-week").click();
  await page.getByTestId("bet-manual-text").fill(bet);
  await page.getByTestId("bet-manual-prediction").fill(prediction);
  await page.getByTestId("bet-manual-save").click();
  await page.getByTestId("nav-bet").click();
  await expect(page.getByTestId("bet-active")).toBeVisible();
  await expect(page.getByTestId("bet-text")).toContainText(bet);
}

/** Dodaj działanie do aktywnego zakładu. */
export async function addAction(page: Page, text: string): Promise<void> {
  await page.getByTestId("nav-bet").click();
  await page.getByTestId("action-add").click();
  await page.getByTestId("action-text").fill(text);
  await page.getByTestId("action-save").click();
  await expect(page.getByTestId("action-item").filter({ hasText: text })).toBeVisible();
}

/** Domknij działanie dowodem-notatką (najlżejszy typ). */
export async function closeActionWithNote(page: Page, actionText: string, note: string): Promise<void> {
  const item = page.getByTestId("action-item").filter({ hasText: actionText });
  await item.getByTestId("action-done").click();
  await page.getByTestId("proof-type-note").click();
  await page.getByTestId("proof-note-text").fill(note);
  await page.getByTestId("proof-submit").click();
  await expect(item.getByTestId("action-status")).toContainText(/zrobione/i);
}
