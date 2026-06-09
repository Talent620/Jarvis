import { store } from "./store";
import { toolDefs, resetCitations, getCitations } from "./tools";
import { PROVIDERS, PROVIDER_LIST, autoPick } from "./providers/registry";
import type { JarvisReply, Msg, ProviderId } from "./providers/types";

// Błędy, przy których warto spróbować kolejnego dostawcy (brak kredytów, limit, autoryzacja).
function shouldFallback(msg: string): boolean {
  return /credit|billing|insufficient|quota|exceeded|rate.?limit|too low|payment|unauthorized|invalid.?api|forbidden|overloaded|unavailable|\b(401|402|403|429|502|503)\b/i.test(
    msg,
  );
}

const isNetworkError = (msg: string) => /failed to fetch|load failed|network|networkerror|timeout/i.test(msg);

// Przetłumacz techniczny błąd na zrozumiały komunikat.
function humanize(msg: string): string {
  if (isNetworkError(msg)) return "Brak połączenia z usługą AI. Sprawdź internet i klucz API (⚙ Ustawienia).";
  if (/401|unauthorized|invalid.?api|forbidden|403/i.test(msg))
    return "Klucz API jest nieprawidłowy, wygasł lub nie ma dostępu — sprawdź go w ⚙ Ustawienia.";
  if (/credit|billing|too low|payment|quota|insufficient/i.test(msg))
    return "Wybrany dostawca nie ma środków/limitu. Przełącz dostawcę lub dodaj inny klucz w ⚙.";
  return msg;
}

// Jednorazowy retry przy chwilowym błędzie sieci.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isNetworkError(msg)) {
      await new Promise((r) => setTimeout(r, 700));
      return fn();
    }
    throw e;
  }
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
  const pid = s.activeProjectId;

  // Pamięć: globalna + bieżącego projektu; przypięte najpierw, potem najnowsze (maks. 25).
  const memory = [...store.data.memory]
    .filter((m) => !m.projectId || m.projectId === pid)
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.createdAt - a.createdAt)
    .slice(0, 25);
  const facts = memory.length
    ? "\n\nZapamiętane fakty o użytkowniku:\n" + memory.map((m) => `- ${m.key}: ${m.value}`).join("\n")
    : "";

  // Kontekst projektu: instrukcje + fragmenty dokumentów (budżet ~6000 zn.).
  const project = pid ? store.data.projects.find((p) => p.id === pid) : null;
  let projectCtx = "";
  if (project) {
    projectCtx = `\n\nAktywny projekt: „${project.name}".`;
    if (project.instructions.trim()) projectCtx += `\nInstrukcje projektu: ${project.instructions.trim()}`;
    const files = store.data.projectFiles.filter((f) => f.projectId === pid);
    if (files.length) {
      let budget = 6000;
      const chunks: string[] = [];
      for (const f of files) {
        const t = f.text.slice(0, Math.max(0, budget));
        if (!t) break;
        chunks.push(`# ${f.name}\n${t}`);
        budget -= t.length;
      }
      projectCtx += `\n\nDokumenty projektu (fragmenty, używaj jako kontekst):\n${chunks.join("\n\n")}`;
    }
  }
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
    `- Gdy potrzeba aktualnych informacji lub źródeł, użyj narzędzia web_research i powołuj się na źródła numerami [1], [2].`,
    `- Akcje zewnętrzne (dzwonienie, SMS, smart home, zapisy) mogą wymagać zgody użytkownika — to normalne; po zgodzie potwierdź wynik.`,
    `- Rozumiej polską odmianę przez przypadki (np. „szparagi", „szparagów", „szparagami" to ta sama rzecz). Dodawaj pozycje na listy i zadania od razu, bez zbędnego dopytywania.`,
    `- Proaktywnie zapamiętuj trwałe preferencje narzędziem remember_fact.`,
    `- Odpowiedzi trzymaj zwięzłe i naturalne — będą czytane na głos.`,
    `- Po wykonaniu akcji potwierdź ją krótko.`,
    `- Jeśli użytkownik dołączy zdjęcie, przeanalizuj je i odnieś się do jego treści.`,
    `- Aktualny czas: ${now.toLocaleString("pl-PL")}.`,
    facts,
    projectCtx,
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

  resetCitations();
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    const { provider, model } = order[i];
    const apiKey = store.settings.keys[provider];
    if (!apiKey?.trim()) continue;
    try {
      const reply = await withRetry(() => PROVIDERS[provider].impl({ ...baseCtx, apiKey, model }));
      const citations = getCitations();
      return citations.length ? { ...reply, citations } : reply;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (i < order.length - 1 && (shouldFallback(msg) || isNetworkError(msg))) continue; // spróbuj kolejnego
      throw new Error(humanize(msg));
    }
  }
  throw new Error(humanize(lastErr instanceof Error ? lastErr.message : String(lastErr)));
}
