import { store } from "./store";
import { toolDefs, resetCitations, getCitations } from "./tools";
import { PROVIDERS, PROVIDER_LIST, autoPick } from "./providers/registry";
import { prepareMemoryContext, memoryBlock, rememberFact, ensureIndexed } from "./memory";
import { isDesktop } from "./desktop";
import { shouldFallback, isNetworkError, humanize, isComplex, PERSONAL_CUES } from "./aiHelpers";
import type { JarvisReply, Msg, ProviderId } from "./providers/types";

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

// --- Router: dobór dostawcy/modelu do zadania ---
const VISION_PROVIDERS = new Set<ProviderId>(["anthropic", "gemini", "github", "openrouter"]);

const TASK_MODELS: Record<ProviderId, { simple: string; complex: string; vision: string }> = {
  anthropic: { simple: "claude-haiku-4-5", complex: "claude-opus-4-8", vision: "claude-opus-4-8" },
  gemini: { simple: "gemini-2.5-flash-lite", complex: "gemini-2.5-flash", vision: "gemini-2.5-flash" },
  groq: { simple: "llama-3.1-8b-instant", complex: "llama-3.3-70b-versatile", vision: "llama-3.3-70b-versatile" },
  openrouter: {
    simple: "meta-llama/llama-3.3-70b-instruct:free",
    complex: "meta-llama/llama-3.1-405b-instruct",
    vision: "google/gemini-2.0-flash-exp:free",
  },
  nvidia: { simple: "meta/llama-3.3-70b-instruct", complex: "meta/llama-3.1-405b-instruct", vision: "meta/llama-3.3-70b-instruct" },
  github: { simple: "openai/gpt-4o-mini", complex: "openai/gpt-4o", vision: "openai/gpt-4o" },
  ollama: { simple: "llama3.2", complex: "llama3.1", vision: "llama3.2" },
};

function modelFor(p: ProviderId, complex: boolean, vision: boolean): string {
  const m = TASK_MODELS[p];
  return vision ? m.vision : complex ? m.complex : m.simple;
}

/** Buduje kolejność prób (dostawca+model) dopasowaną do zadania. */
function routeOrder(history: Msg[]): { provider: ProviderId; model: string }[] {
  const s = store.settings;
  const last = history[history.length - 1];
  const hasImage = !!last?.image;
  const complex = isComplex(last?.content || "");

  if (s.provider === "auto" && (s.model === "auto" || !s.model)) {
    let provs = PROVIDER_LIST.filter((p) => s.keys[p.id]?.trim());
    if (hasImage) {
      const vis = provs.filter((p) => VISION_PROVIDERS.has(p.id));
      if (vis.length) provs = vis; // do obrazu wybierz dostawcę z wizją
    }
    provs.sort((a, b) => b.rank - a.rank);
    return provs.map((p) => ({ provider: p.id, model: modelFor(p.id, complex, hasImage) }));
  }

  const resolved = resolveProvider()!;
  return [
    { provider: resolved.provider, model: resolved.model },
    ...PROVIDER_LIST.filter((p) => p.id !== resolved.provider && s.keys[p.id]?.trim())
      .sort((a, b) => b.rank - a.rank)
      .map((p) => ({ provider: p.id, model: p.defaultModel })),
  ];
}

export function systemPrompt(): string {
  const s = store.settings;
  const userName = s.userName;
  const pid = s.activeProjectId;

  // Pamięć autonomiczna: trafne fakty wybrane semantycznie (z fallbackiem na świeżość).
  const facts = memoryBlock();

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
    isDesktop()
      ? `- Jesteś na KOMPUTERZE (Windows). Sterujesz nim narzędziami desktop_*: uruchamianie programów (desktop_launch_app), otwieranie plików/folderów/URL (desktop_open), pisanie tekstu (desktop_type — podaj 'window' z tytułem okna, gdy chcesz pisać do innej aplikacji; najpierw ją uruchom/aktywuj), skróty klawiszowe (desktop_hotkey, np. ctrl+s), odtwarzanie (desktop_media), głośność (desktop_volume), zasilanie (desktop_power — wymaga zgody). Gdy użytkownik pyta „co mam na ekranie", zrzut ekranu dołącza się automatycznie — opisz go i pomóż.`
      : `- Jesteś na URZĄDZENIU MOBILNYM. Korzystaj z dzwonienia, SMS, nawigacji, otwierania aplikacji i kamery.`,
    `- Gdy potrzeba aktualnych informacji lub źródeł, użyj narzędzia web_research i powołuj się na źródła numerami [1], [2].`,
    `- Akcje zewnętrzne (dzwonienie, SMS, smart home, zapisy) mogą wymagać zgody użytkownika — to normalne; po zgodzie potwierdź wynik.`,
    `- Rozumiej polską odmianę przez przypadki (np. „szparagi", „szparagów", „szparagami" to ta sama rzecz). Dodawaj pozycje na listy i zadania od razu, bez zbędnego dopytywania.`,
    `- Proaktywnie zapamiętuj trwałe preferencje narzędziem remember_fact.`,
    `- Odpowiedzi trzymaj zwięzłe i naturalne — będą czytane na głos.`,
    `- Po wykonaniu akcji potwierdź ją krótko.`,
    `- Bądź proaktywny: po wykonaniu zadania, jeśli to pomocne, krótko zaproponuj sensowny następny krok. Sam zauważaj zależności (np. termin → zaproponuj przypomnienie).`,
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
  // Lokalny model (Ollama) nie używa klucza — poświadczeniem jest adres serwera.
  const apiKey = provider === "ollama" ? (s.ollamaUrl?.trim() ? "local" : "") : s.keys[provider];
  return { provider, model, apiKey };
}

/** Szybki test: czy wybrany dostawca/klucz działa. */
export async function testApi(): Promise<string> {
  const r = resolveProvider();
  if (!r) return "❌ Brak skonfigurowanego dostawcy AI (⚙).";
  if (!r.apiKey?.trim()) return `❌ Brak klucza dla ${PROVIDERS[r.provider].label}.`;
  try {
    const reply = await PROVIDERS[r.provider].impl({
      system: "Odpowiedz wyłącznie jednym słowem: OK.",
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: "ping" }],
      apiKey: r.apiKey,
      model: r.model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    return reply.text ? `✅ Działa: ${PROVIDERS[r.provider].label} · ${r.model}.` : "⚠️ Połączono, ale brak odpowiedzi.";
  } catch (e) {
    return `❌ ${humanize(e instanceof Error ? e.message : String(e))}`;
  }
}

// === Pamięć autonomiczna: uczenie się w tle ===
// Po każdej wymianie (z rozsądnym throttlingiem) JARVIS sam wyłuskuje trwałe
// fakty/preferencje i zapisuje je do pamięci — także gdy nie użył narzędzia.
let lastLearnAt = 0;
const LEARN_COOLDOWN = 15_000; // nie częściej niż co 15 s

// Tania bramka: ekstrakcję uruchamiamy tylko, gdy wypowiedź wygląda na niosącą
// trwałą informację o użytkowniku (oszczędza limity API) — PERSONAL_CUES z aiHelpers.
async function learnFromExchange(userText: string, replyText: string): Promise<void> {
  if (store.settings.interpreterMode) return; // w trybie tłumacza nie zapamiętujemy
  const text = (userText || "").trim();
  if (text.length < 12) return; // za mało treści, by warto było analizować
  if (!PERSONAL_CUES.test(text)) return; // brak sygnałów trwałej informacji
  const now = Date.now();
  if (now - lastLearnAt < LEARN_COOLDOWN) return;
  lastLearnAt = now;

  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) return;
  // Do ekstrakcji bierzemy najtańszy model danego dostawcy.
  const model = TASK_MODELS[r.provider]?.simple || r.model;

  const existingKeys = store.data.memory
    .filter((m) => !m.projectId || m.projectId === (store.settings.activeProjectId || ""))
    .map((m) => m.key)
    .slice(0, 60)
    .join(", ");

  const system = [
    "Jesteś modułem pamięci długoterminowej asystenta. Z poniższej wymiany wyłuskaj WYŁĄCZNIE trwałe,",
    "przydatne na przyszłość fakty i preferencje o użytkowniku (imiona bliskich, adresy, praca, ulubione rzeczy,",
    "dieta, nawyki, cele, stałe ustalenia). POMIŃ rzeczy chwilowe, ogólną wiedzę i treść samej odpowiedzi asystenta.",
    existingKeys ? `Już zapamiętane klucze (nie powielaj bez potrzeby): ${existingKeys}.` : "",
    'Zwróć WYŁĄCZNIE JSON: {"facts":[{"key":"krotki_klucz","value":"wartosc"}]} — pusta lista, jeśli nic trwałego.',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const reply = await PROVIDERS[r.provider].impl({
      system,
      webSearch: false,
      tools: [],
      history: [{ role: "user", content: `Użytkownik: ${text}\n\nAsystent: ${(replyText || "").slice(0, 800)}` }],
      apiKey: r.apiKey,
      model,
      proxyUrl: store.settings.proxyUrl?.trim() || undefined,
    });
    const raw = reply.text || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]) as { facts?: { key?: string; value?: string }[] };
    const facts = Array.isArray(parsed.facts) ? parsed.facts.slice(0, 5) : [];
    const pid = store.settings.activeProjectId || undefined;
    for (const f of facts) {
      const key = (f.key || "").trim().slice(0, 60);
      const value = (f.value || "").trim().slice(0, 300);
      if (!key || !value) continue;
      const existing = store.data.memory.find(
        (m) => m.key === key && (m.projectId || "") === (pid || ""),
      );
      if (existing && existing.value === value) continue; // bez zmian
      rememberFact(key, value, pid);
    }
    void ensureIndexed();
  } catch {
    /* uczenie jest „best-effort" — błędy ignorujemy */
  }
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

  // Pamięć autonomiczna: dobierz fakty trafne do bieżącego zapytania (przed promptem).
  const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
  await prepareMemoryContext(lastUser?.content || "");

  const baseCtx = {
    system: systemPrompt(),
    webSearch: store.settings.webSearch,
    tools: toolDefs,
    history: trimmed,
    proxyUrl: store.settings.proxyUrl?.trim() || undefined,
  };

  // Router dobiera dostawcę+model do zadania (prostota/złożoność/obraz) + fallback.
  const order = routeOrder(trimmed);

  resetCitations();
  let lastErr: unknown;
  for (let i = 0; i < order.length; i++) {
    const { provider, model } = order[i];
    const apiKey = store.settings.keys[provider];
    if (!apiKey?.trim()) continue;
    try {
      const reply = await withRetry(() => PROVIDERS[provider].impl({ ...baseCtx, apiKey, model }));
      const citations = getCitations();
      // Ucz się w tle: wyłuskaj trwałe fakty z wymiany (nie blokuje odpowiedzi).
      void learnFromExchange(lastUser?.content || "", reply.text);
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
