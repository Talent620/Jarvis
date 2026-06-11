import { resolveProvider } from "./brain";
import { PROVIDERS } from "./providers/registry";
import { store } from "./store";
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
  "- Zwróć WYŁĄCZNIE treść wiadomości. Pierwsza linia: „Temat: …”.",
].join("\n");

export async function draftOffer(lead: Lead): Promise<string> {
  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) return "";
  const ctx = `Firma: ${lead.company}\nBranża: ${lead.niche || "—"}\nLokalizacja: ${lead.location || "—"}\nStrona: ${lead.url || "brak lub słaba"}\nNotatka: ${lead.note || "—"}`;
  try {
    const reply = await PROVIDERS[r.provider].impl({
      system: SYSTEM,
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: `Napisz ofertę dla:\n${ctx}` }],
      apiKey: r.apiKey,
      model: r.model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    return (reply.text || "").trim();
  } catch {
    return "";
  }
}
