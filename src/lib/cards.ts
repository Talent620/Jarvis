import { store, uid } from "./store";
import { resolveProvider } from "./brain";
import { PROVIDERS } from "./providers/registry";
import { humanize } from "./aiHelpers";
import type { Flashcard } from "../types";

// === Kapsuły Wiedzy — powtórki rozłożone w czasie (SM-2) ===
// Algorytm SM-2 (SuperMemo / Anki): po każdej powtórce odstęp do następnej rośnie
// tym bardziej, im lepiej pamiętasz — to najskuteczniejszy znany sposób trwałego
// zapamiętywania (Cepeda 2006, Pan & Rickard 2018). Wszystko offline; treść fiszek
// generuje AI z Twoich notatek/dziennika/researchu.

const DAY = 86_400_000;
const START_EASE = 2.5;
const MIN_EASE = 1.3;

/** Oceny przypomnienia (mapowane na skalę SM-2 0–5). */
export type Grade = "again" | "hard" | "good" | "easy";
const GRADE_Q: Record<Grade, number> = { again: 2, hard: 3, good: 4, easy: 5 };

/** Czysty SM-2: zwraca zaktualizowany stan fiszki po ocenie (testowalny). */
export function schedule(card: Flashcard, grade: Grade, now = Date.now()): Flashcard {
  const q = GRADE_Q[grade];
  let { ease, interval, reps, lapses } = card;

  if (q < 3) {
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
  }
  // Korekta łatwości wg oryginalnego wzoru SM-2, z dolnym ograniczeniem 1.3.
  ease = Math.max(MIN_EASE, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  return { ...card, ease, interval, reps, lapses, due: now + interval * DAY };
}

/** Zapisz ocenę powtórki do magazynu. */
export function reviewCard(id: string, grade: Grade): void {
  store.setData((d) => {
    const c = d.flashcards.find((x) => x.id === id);
    if (c) Object.assign(c, schedule(c, grade));
  });
}

/** Fiszki do powtórki TERAZ (due ≤ now), najpilniejsze pierwsze. */
export function dueCards(now = Date.now()): Flashcard[] {
  return (store.data.flashcards || []).filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}

export const dueCount = (now = Date.now()): number => dueCards(now).length;

/** Nowa fiszka (od razu „due", więc trafia do najbliższej sesji). */
export function addCard(front: string, back: string, deck?: string, source?: string): Flashcard {
  const card: Flashcard = {
    id: uid(),
    front: front.trim(),
    back: back.trim(),
    deck: deck?.trim() || undefined,
    source: source?.trim() || undefined,
    ease: START_EASE,
    interval: 0,
    reps: 0,
    lapses: 0,
    due: Date.now(),
    createdAt: Date.now(),
  };
  store.setData((d) => d.flashcards.unshift(card));
  return card;
}

export function removeCard(id: string): void {
  store.setData((d) => {
    d.flashcards = d.flashcards.filter((c) => c.id !== id);
  });
}

export interface CardStats {
  total: number;
  due: number;
  learned: number; // z interwałem ≥ 21 dni — „w pamięci długotrwałej"
  decks: number;
}
export function cardStats(now = Date.now()): CardStats {
  const all = store.data.flashcards || [];
  return {
    total: all.length,
    due: all.filter((c) => c.due <= now).length,
    learned: all.filter((c) => c.interval >= 21).length,
    decks: new Set(all.map((c) => c.deck || "").filter(Boolean)).size,
  };
}

const GEN_SYSTEM = [
  "Jesteś ekspertem od skutecznej nauki. Z podanego materiału tworzysz zwięzłe fiszki do",
  "aktywnego przypominania. Każda fiszka: KONKRETNE pytanie (front) i krótka, jednoznaczna",
  "odpowiedź (back). Jedna myśl na fiszkę (zasada minimalnej informacji). Bez wstępów.",
  'Zwróć WYŁĄCZNIE JSON: {"cards":[{"front":"…","back":"…"}]} — po polsku.',
].join("\n");

/** Wygeneruj fiszki AI z dowolnego tekstu/tematu. Zwraca liczbę dodanych lub błąd. */
export async function generateCards(material: string, deck?: string, source?: string, max = 8): Promise<{ added: number } | { error: string }> {
  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) return { error: "Najpierw skonfiguruj dostawcę AI w ⚙ → AI." };
  try {
    const reply = await PROVIDERS[r.provider].impl({
      system: GEN_SYSTEM,
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: `Zrób maksymalnie ${max} fiszek z tego materiału:\n\n${material.slice(0, 6000)}` }],
      apiKey: r.apiKey,
      model: r.model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    const m = (reply.text || "").match(/\{[\s\S]*\}/);
    if (!m) return { error: "Nie udało się utworzyć fiszek — spróbuj innym materiałem." };
    const parsed = JSON.parse(m[0]) as { cards?: { front?: string; back?: string }[] };
    const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
    let added = 0;
    for (const c of cards.slice(0, max)) {
      if (c.front?.trim() && c.back?.trim()) {
        addCard(c.front, c.back, deck, source);
        added++;
      }
    }
    return added ? { added } : { error: "Model nie zwrócił sensownych fiszek." };
  } catch (e) {
    return { error: humanize(e instanceof Error ? e.message : String(e)) };
  }
}
