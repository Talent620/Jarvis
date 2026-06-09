import { store } from "./store";
import { toolDefs } from "./tools";
import { PROVIDERS, PROVIDER_LIST, autoPick } from "./providers/registry";
import type { JarvisReply, Msg, ProviderId } from "./providers/types";

// Błędy, przy których warto spróbować kolejnego dostawcy (brak kredytów, limit, autoryzacja).
function shouldFallback(msg: string): boolean {
  return /credit|billing|insufficient|quota|exceeded|rate.?limit|too low|payment|unauthorized|invalid.?api|forbidden|overloaded|unavailable|\b(401|402|403|429|502|503)\b/i.test(
    msg,
  );
}

const PERSONAS: Record<string, string> = {
  classic: "uprzejmy, lekko dowcipny brytyjski majordomus — elegancki, rzeczowy i niezwykle kompetentny.",
  concise: "maksymalnie zwięzły — odpowiadasz w 1–2 zdaniach, bez ozdobników i powtórzeń.",
  warm: "ciepły, wspierający i empatyczny — dbasz o samopoczucie użytkownika, zachowując kompetencję.",
  witty: "błyskotliwy, z suchym brytyjskim humorem i lekkim sarkazmem, ale zawsze pomocny i rzeczowy.",
};

export function systemPrompt(): string {
  const s = store.settings;
  const userName = s.userName;
  const memory = store.data.memory;
  const facts = memory.length
    ? "\n\nZapamiętane fakty o użytkowniku:\n" + memory.map((m) => `- ${m.key}: ${m.value}`).join("\n")
    : "";
  const now = new Date();

  // Tryb tłumacza ma priorytet — JARVIS staje się tłumaczem na żywo.
  if (s.interpreterMode) {
    return [
      `Jesteś tłumaczem symultanicznym JARVIS. Tłumaczysz między językami: ${s.interpreterFrom} i ${s.interpreterTo}.`,
      `Wykryj język wypowiedzi użytkownika i przetłumacz ją na drugi z tych języków.`,
      `Zwracaj WYŁĄCZNIE samo tłumaczenie — bez komentarzy, wyjaśnień ani powtarzania oryginału.`,
      `Zachowuj ton i rejestr wypowiedzi.`,
    ].join("\n");
  }

  const tone = PERSONAS[s.persona] ?? PERSONAS.classic;
  const extra = s.customPersona.trim() ? `\nDodatkowe wytyczne osobowości: ${s.customPersona.trim()}` : "";
  return [
    `Jesteś JARVIS — zaawansowany, autonomiczny asystent AI w stylu filmowego asystenta Tony'ego Starka.`,
    `Zwracasz się do użytkownika per „${userName}". Mówisz po polsku, chyba że użytkownik użyje innego języka.`,
    `Charakter: ${tone}${extra}`,
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

  const baseCtx = {
    system: systemPrompt(),
    webSearch: store.settings.webSearch,
    tools: toolDefs,
    history: trimmed,
    proxyUrl: store.settings.proxyUrl?.trim() || undefined,
  };

  // Kolejność prób: wybrany dostawca, a potem pozostali z kluczem (wg rangi).
  const order: { provider: ProviderId; model: string }[] = [
    { provider: resolved.provider, model: resolved.model },
    ...PROVIDER_LIST.filter((p) => p.id !== resolved.provider && store.settings.keys[p.id]?.trim())
      .sort((a, b) => b.rank - a.rank)
      .map((p) => ({ provider: p.id, model: p.defaultModel })),
  ];

  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    const { provider, model } = order[i];
    const apiKey = store.settings.keys[provider];
    if (!apiKey?.trim()) continue;
    try {
      return await PROVIDERS[provider].impl({ ...baseCtx, apiKey, model });
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (i < order.length - 1 && shouldFallback(msg)) continue; // spróbuj kolejnego
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
