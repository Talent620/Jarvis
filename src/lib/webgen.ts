import { resolveProvider } from "./brain";
import { PROVIDERS } from "./providers/registry";
import { humanize } from "./aiHelpers";
import { store } from "./store";

// Autonomiczny generator stron: z opisu tworzy KOMPLETNĄ, nowoczesną stronę w
// jednym pliku HTML (z wbudowanym CSS i JS). Działa z dowolnym dostawcą AI.

const SYSTEM = [
  "Jesteś światowej klasy front-end developerem i projektantem UI. Tworzysz KOMPLETNE, nowoczesne, responsywne strony w JEDNYM pliku HTML (z wbudowanym CSS i JavaScript).",
  "ZASADY (bezwzględne):",
  "- Zwróć WYŁĄCZNIE kod, zaczynając od <!DOCTYPE html>. Żadnych komentarzy poza kodem, żadnych bloków ```.",
  "- Estetyka klasy premium: spójna paleta, świetna typografia, oddech (odstępy), mikrointerakcje, stany hover, płynne animacje, gradienty/cienie z umiarem.",
  "- W pełni responsywne (mobile-first). Bez zewnętrznych bibliotek JS/CSS. Dozwolone tylko czcionki Google Fonts przez <link>.",
  "- REALNA treść dopasowana do tematu (nie lorem ipsum): sensowny nagłówek z nawigacją, sekcje hero/oferta/o nas/kontakt, stopka, wyraźne CTA.",
  "- Kod ma być kompletny i działający po otwarciu w przeglądarce.",
].join("\n");

function extractHtml(text: string): string {
  let s = (text || "").trim();
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const i = s.search(/<!doctype html|<html/i);
  if (i >= 0) s = s.slice(i);
  return s.includes("<") ? s : "";
}

export async function generateSite(prompt: string, current?: string): Promise<{ html: string } | { error: string }> {
  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) return { error: "Najpierw skonfiguruj dostawcę AI w ⚙ → AI." };

  const userMsg = current
    ? `Oto obecny kod strony:\n\n${current.slice(0, 14000)}\n\nWprowadź zmianę: ${prompt}\nZwróć PEŁNY, zaktualizowany plik HTML (od <!DOCTYPE html>).`
    : `Zbuduj stronę według opisu: ${prompt}`;

  try {
    const reply = await PROVIDERS[r.provider].impl({
      system: SYSTEM,
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: userMsg }],
      apiKey: r.apiKey,
      model: r.model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    const html = extractHtml(reply.text || "");
    if (!html) return { error: "Model nie zwrócił kodu HTML — spróbuj doprecyzować opis." };
    return { html };
  } catch (e) {
    return { error: humanize(e instanceof Error ? e.message : String(e)) };
  }
}
