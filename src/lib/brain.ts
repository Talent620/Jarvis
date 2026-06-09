import { store } from "./store";
import { toolDefs } from "./tools";
import { PROVIDERS, autoPick } from "./providers/registry";
import type { JarvisReply, Msg, ProviderId } from "./providers/types";

export function systemPrompt(): string {
  const { userName } = store.settings;
  const memory = store.data.memory;
  const facts = memory.length
    ? "\n\nZapamiętane fakty o użytkowniku:\n" + memory.map((m) => `- ${m.key}: ${m.value}`).join("\n")
    : "";
  const now = new Date();
  return [
    `Jesteś JARVIS — zaawansowany, autonomiczny asystent AI w stylu filmowego asystenta Tony'ego Starka.`,
    `Zwracasz się do użytkownika per „${userName}". Mówisz po polsku, chyba że użytkownik użyje innego języka.`,
    `Charakter: uprzejmy, lekko dowcipny, niezwykle kompetentny i konkretny. Bez lania wody.`,
    ``,
    `Zasady:`,
    `- Gdy użytkownik o coś prosi, DZIAŁAJ przez narzędzia (zadania, notatki, przypomnienia, kalendarz, zakupy, otwieranie aplikacji, dzwonienie, nawigacja, smart home).`,
    `- Gdy potrzeba aktualnych informacji, korzystaj z wyszukiwania w sieci (jeśli dostępne).`,
    `- Proaktywnie zapamiętuj trwałe preferencje narzędziem remember_fact.`,
    `- Odpowiedzi trzymaj zwięzłe i naturalne — będą czytane na głos.`,
    `- Po wykonaniu akcji potwierdź ją krótko.`,
    `- Jeśli użytkownik dołączy zdjęcie, przeanalizuj je i odnieś się do jego treści.`,
    `- Aktualny czas: ${now.toLocaleString("pl-PL")}.`,
    facts,
  ].join("\n");
}

/** Rozstrzyga, którego dostawcę i model użyć (uwzględnia tryb auto). */
export function resolveProvider(): { provider: ProviderId; model: string; apiKey: string } | null {
  const s = store.settings;
  if (s.provider === "auto") {
    const pick = autoPick(s.keys);
    if (!pick) return null;
    return { ...pick, apiKey: s.keys[pick.provider] };
  }
  const provider = s.provider as ProviderId;
  const meta = PROVIDERS[provider];
  if (!meta) return null;
  const model = s.model && s.model !== "auto" ? s.model : meta.defaultModel;
  return { provider, model, apiKey: s.keys[provider] };
}

export async function askJarvis(history: Msg[]): Promise<JarvisReply> {
  const resolved = resolveProvider();
  if (!resolved) {
    throw new Error(
      "Brak skonfigurowanego dostawcy AI. Wejdź w ⚙ Ustawienia i wprowadź klucz API (Claude, Gemini, Groq, OpenRouter, NVIDIA lub GitHub).",
    );
  }
  if (!resolved.apiKey?.trim()) {
    throw new Error(
      `Brak klucza API dla: ${PROVIDERS[resolved.provider].label}. Uzupełnij go w ⚙ Ustawienia.`,
    );
  }

  // Obraz dołączamy tylko do ostatniej wiadomości — nie zaśmiecamy kontekstu base64.
  const trimmed: Msg[] = history.map((m, i) =>
    i === history.length - 1 ? m : { role: m.role, content: m.content },
  );

  const meta = PROVIDERS[resolved.provider];
  return meta.impl({
    apiKey: resolved.apiKey,
    model: resolved.model,
    system: systemPrompt(),
    webSearch: store.settings.webSearch,
    tools: toolDefs,
    history: trimmed,
    proxyUrl: store.settings.proxyUrl?.trim() || undefined,
  });
}
