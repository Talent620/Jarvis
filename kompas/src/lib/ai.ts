// W2 Typed Memory — analiza AI tygodnia (Wykonawca A).
// Jedno wywołanie API Anthropic; funkcja NICZEGO nie zapisuje do bazy —
// zwraca propozycję, o której decyduje człowiek (S05).
import { now } from "./db";
import { weekStats, type WeekStatsResult } from "./week";

const KLUCZ_LS = "kompas.apiKey"; // jedyne dozwolone użycie localStorage w produkcie

export interface AiProposal {
  bet: string;
  prediction: string;
}

/** Odczytaj klucz API z localStorage (null, gdy brak). */
export function getApiKey(): string | null {
  try {
    const v = localStorage.getItem(KLUCZ_LS);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Zapisz klucz API do localStorage. */
export function setApiKey(key: string): void {
  try {
    localStorage.setItem(KLUCZ_LS, key.trim());
  } catch {
    // brak dostępu do localStorage — klucz nie zostanie zapamiętany
  }
}

/** Zbuduj prompt z lokalnych statystyk tygodnia — model widzi tylko liczby. */
function buildPrompt(stats: WeekStatsResult): string {
  const linieDni = stats.days
    .map(
      (d) =>
        "- " +
        d.label +
        ": wpisów " +
        d.count +
        (d.avgScore !== null ? ", średnia ocena " + d.avgScore : "")
    )
    .join("\n");
  // Przykład kształtu odpowiedzi budujemy przez JSON.stringify,
  // żeby nie wpisywać cudzysłowów prostych wewnątrz stringów.
  const ksztalt = JSON.stringify({
    bet: "jeden konkretny zakład behawioralny po polsku",
    prediction: "falsyfikowalne przewidywanie po polsku",
  });
  return [
    "Jesteś asystentem produktu KOMPAS. Oto lokalne statystyki wpisów dziennych",
    "użytkownika z ostatnich 7 dni (oceny 1-5, wyżej = lepiej):",
    "Łącznie wpisów: " + stats.count,
    linieDni,
    "",
    "Na podstawie tych danych zaproponuj DOKŁADNIE JEDEN zakład behawioralny",
    "(małe, powtarzalne zachowanie na najbliższy tydzień) oraz jedno",
    "falsyfikowalne przewidywanie (co konkretnie ma się zmienić w ocenach).",
    "Odpowiedz WYŁĄCZNIE czystym JSON, bez komentarzy, w kształcie:",
    ksztalt,
  ].join("\n");
}

/** Wytnij pierwszy zbalansowany blok {...} z tekstu odpowiedzi. */
function wytnijJson(text: string): string {
  const start = text.indexOf("{");
  if (start !== -1) {
    let glebokosc = 0;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") glebokosc += 1;
      else if (ch === "}") {
        glebokosc -= 1;
        if (glebokosc === 0) return text.slice(start, i + 1);
      }
    }
  }
  throw new Error("Odpowiedź AI nie zawiera poprawnego bloku JSON — spróbuj ponownie.");
}

/**
 * Jedno wywołanie POST https://api.anthropic.com/v1/messages.
 * Zwraca { bet, prediction } albo rzuca czytelny błąd po polsku.
 */
export async function analyzeWeek(): Promise<AiProposal> {
  const key = getApiKey();
  if (!key) {
    throw new Error("Brak klucza API — zapisz klucz, aby użyć analizy AI.");
  }
  const stats = weekStats(now());
  const prompt = buildPrompt(stats);

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch {
    throw new Error("Błąd sieci — nie udało się połączyć z API Anthropic. Spróbuj ponownie.");
  }

  if (!resp.ok) {
    throw new Error("Błąd API Anthropic (kod " + resp.status + ") — sprawdź klucz i spróbuj ponownie.");
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    throw new Error("Odpowiedź API nie jest poprawnym JSON — spróbuj ponownie.");
  }

  const content = (data as { content?: { text?: unknown }[] }).content;
  const text = content && content[0] ? content[0].text : undefined;
  if (typeof text !== "string") {
    throw new Error("Odpowiedź API ma nieoczekiwany kształt — brak tekstu do analizy.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(wytnijJson(text));
  } catch (e) {
    if (e instanceof Error && e.message.indexOf("bloku JSON") !== -1) throw e;
    throw new Error("Nie udało się sparsować propozycji AI — spróbuj ponownie.");
  }

  const bet = (parsed as { bet?: unknown }).bet;
  const prediction = (parsed as { prediction?: unknown }).prediction;
  if (typeof bet !== "string" || !bet.trim() || typeof prediction !== "string" || !prediction.trim()) {
    throw new Error("Propozycja AI ma błędny kształt (oczekiwano pól bet i prediction) — spróbuj ponownie.");
  }

  return { bet: bet.trim(), prediction: prediction.trim() };
}
