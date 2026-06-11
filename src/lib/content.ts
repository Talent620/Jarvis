import { resolveProvider } from "./brain";
import { PROVIDERS } from "./providers/registry";
import { humanize } from "./aiHelpers";
import { store } from "./store";

// Generatory treści zarobkowej — paczki postów (sprzedaż przez treść/afiliacja)
// oraz pomysły na produkty cyfrowe do sprzedaży (Gumroad/Etsy/własny sklep).

async function ask(system: string, user: string): Promise<{ text: string } | { error: string }> {
  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) return { error: "Najpierw skonfiguruj dostawcę AI w ⚙ → AI." };
  try {
    const reply = await PROVIDERS[r.provider].impl({
      system,
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: user }],
      apiKey: r.apiKey,
      model: r.model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    return { text: (reply.text || "").trim() };
  } catch (e) {
    return { error: humanize(e instanceof Error ? e.message : String(e)) };
  }
}

const CONTENT_SYSTEM = [
  "Jesteś topowym strategiem content-marketingu (po polsku). Tworzysz gotowe do publikacji posty, które budują markę i sprzedają bez nachalności.",
  "Dla podanej niszy i platformy napisz paczkę postów. Każdy post: mocny haczyk w 1. linii, realna wartość, jasne CTA, 3–5 trafnych hashtagów.",
  "Różnicuj formaty (porada, mit vs fakt, historia, lista, pytanie do społeczności). Zwięźle, konkretnie, bez lania wody.",
  "Format: numeruj posty „— Post 1 —” itd. Zwróć wyłącznie treść postów.",
].join("\n");

export async function generateContentPack(niche: string, platform: string, count = 5) {
  return ask(CONTENT_SYSTEM, `Nisza: ${niche}\nPlatforma: ${platform}\nLiczba postów: ${count}`);
}

const PRODUCT_SYSTEM = [
  "Jesteś doradcą od cyfrowych produktów do samodzielnej sprzedaży (e-booki, szablony, kursy, printable, presety).",
  "Dla podanej niszy zaproponuj 5 KONKRETNYCH produktów, które solo-twórca może zrobić szybko i sprzedać online.",
  "Dla każdego: nazwa, co zawiera, dla kogo, realny zakres ceny (PLN), gdzie sprzedać, i pierwszy krok wykonania.",
  "Bądź realistyczny (bez obietnic łatwych fortun). Zwięźle, w punktach.",
].join("\n");

export async function generateProductIdeas(niche: string) {
  return ask(PRODUCT_SYSTEM, `Nisza/zainteresowania: ${niche}`);
}
