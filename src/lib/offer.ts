import { askModel } from "./brain";
import type { Lead } from "../types";

// Generator ofert (cold outreach) — JARVIS pisze krótki, spersonalizowany mail
// sprzedażowy dla danego leada. Gotowy szkic czeka w Pulpicie do wysłania.

const SYSTEM = [
  "Jesteś światowej klasy copywriterem sprzedażowym (cold outreach po polsku). Piszesz krótkie, spersonalizowane wiadomości do lokalnych firm z ofertą nowoczesnej strony internetowej.",
  "ZASADY:",
  "- Maks. 90 słów. Konkret, zero lania wody, zero nachalności i clickbaitu.",
  "- Personalizuj: nazwa firmy, branża, lokalizacja, zauważony problem.",
  "- Struktura: zaczep (zauważyłem…) → realna wartość dla nich → dowód (mam już gotowe demo do pokazania) → jedno proste pytanie-CTA.",
  "- Ton: uprzejmy, profesjonalny, ludzki. Bez obietnic bez pokrycia.",
  "- NIE dodawaj podpisu ani placeholderów w nawiasach (np. [Twoje imię i nazwisko], [Nazwa firmy], [Telefon]) — podpis (imię, telefon, strona) dokleimy automatycznie. Zakończ na pytaniu-CTA lub krótkim zwrocie grzecznościowym (np. Pozdrawiam) BEZ nazwiska.",
  "- Zwróć WYŁĄCZNIE treść wiadomości. Pierwsza linia: „Temat: …”.",
].join("\n");

export async function draftOffer(lead: Lead): Promise<string> {
  const ctx = `Firma: ${lead.company}\nBranża: ${lead.niche || "—"}\nLokalizacja: ${lead.location || "—"}\nStrona: ${lead.url || "brak lub słaba"}\nNotatka: ${lead.note || "—"}`;
  try {
    // askModel ma pełny failover (rotacja kluczy + przełączanie dostawców + retry) — jak czat.
    // Dzięki temu jeden chwilowy błąd (429/timeout) nie kończy się pustą ofertą.
    return (await askModel({ system: SYSTEM, history: [{ role: "user", content: `Napisz ofertę dla:\n${ctx}` }], heavy: true })).trim();
  } catch {
    return "";
  }
}
