import { store } from "./store";
import { PROVIDERS, PROVIDER_LIST } from "./providers/registry";
import { orderedKeys } from "./keys";
import { memoryBlock, prepareMemoryContext } from "./memory";
import type { Msg, JarvisReply, ProviderId } from "./providers/types";
import { runDecisionCouncil, type DecisionInput, type DecisionResult, type RoleRunner } from "./decisionEngine";

// === Tryb Konsylium (Council Mode) — pionierska funkcja ===
// Przy ważnych/złożonych pytaniach JARVIS nie pyta JEDNEGO modelu, tylko KILKU
// różnych dostawców równolegle (np. Gemini + Groq + Cerebras), a osobny model-
// sędzia syntezuje z nich jedną, najlepszą odpowiedź i wykrywa rozbieżności
// („2 z 3 zgodne; jeden ostrzega o X"). Redukuje halucynacje i pokazuje, gdy
// temat jest niepewny — coś, czego pojedynczy asystent (ChatGPT/Gemini/Alexa)
// z definicji nie potrafi. Wykorzystuje przewagę tej aplikacji: wielu darmowych
// dostawców skonfigurowanych naraz.

export interface CouncilMember {
  provider: ProviderId;
  model: string;
  label: string;
}

export interface CouncilReply extends JarvisReply {
  council: {
    members: { label: string; text: string }[];
    /** "full" — pełna zgoda, "partial" — częściowa, "conflict" — sprzeczność, "single" — 1 model. */
    consensus: "full" | "partial" | "conflict" | "single";
    note: string;
  };
}

/** Do konsylium bierzemy do `max` RÓŻNYCH dostawców z kluczem, najwyżej ocenianych. */
export function councilMembers(max = 3): CouncilMember[] {
  const members = PROVIDER_LIST.filter((p) => p.id !== "ollama" && orderedKeys(p.id).length > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, max)
    .map((p) => ({ provider: p.id as ProviderId, model: p.defaultModel, label: p.label.split(" (")[0] }));
  // Konsylium Hybrydowe (Z10): lokalny ekspert (darmowy, prywatny, działa offline) jako DODATKOWY
  // głos na końcu listy. Dokłada różnorodność i kotwiczy naradę nawet bez sieci. Sędzia (members[0])
  // zostaje najlepszą Korą, bo lokalnego dokładamy na koniec.
  if (store.settings.councilIncludeLocal && store.settings.ollamaUrl?.trim()) {
    members.push({ provider: "ollama", model: PROVIDERS.ollama.defaultModel, label: "Lokalny (prywatny)" });
  }
  return members;
}

const MEMBER_SYSTEM = (userName: string, facts: string): string =>
  [
    `Jesteś ekspertem w konsylium asystenta JARVIS. Odpowiadasz użytkownikowi (${userName}) po polsku:`,
    `rzeczowo, konkretnie i uczciwie. Jeśli czegoś nie wiesz na pewno — powiedz to wprost, nie zgaduj.`,
    `Nie wspominaj, że jesteś częścią konsylium ani że są inne modele.`,
    facts,
  ]
    .filter(Boolean)
    .join("\n");

const TIMEOUT_MS = 30_000;
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS)),
  ]);
}

/** Zapytaj jednego członka konsylium (bez narzędzi — czyste rozumowanie). */
async function askMember(m: CouncilMember, system: string, history: Msg[]): Promise<string | null> {
  // Lokalni członkowie (Ollama/WebLLM) nie mają klucza — autoryzują się adresem serwera/WebGPU.
  const apiKey = m.provider === "ollama" || m.provider === "webllm" ? "local" : orderedKeys(m.provider)[0];
  if (!apiKey) return null;
  try {
    const r = await withTimeout(
      PROVIDERS[m.provider].impl({
        system,
        webSearch: false,
        tools: [],
        history,
        apiKey,
        model: m.model,
        proxyUrl: store.settings.proxyUrl?.trim() || undefined,
      }),
    );
    return (r.text || "").trim() || null;
  } catch {
    return null; // jeden model padł — konsylium działa dalej z pozostałymi
  }
}

const JUDGE_SYSTEM = [
  "Jesteś sędzią-syntezatorem w konsylium ekspertów AI. Dostajesz pytanie użytkownika i kilka",
  "niezależnych odpowiedzi ekspertów. Twoje zadanie:",
  "1) Zbuduj JEDNĄ najlepszą, spójną odpowiedź po polsku — wybierz to, co trafne, odrzuć błędy.",
  "2) Oceń zgodność ekspertów.",
  'Zwróć WYŁĄCZNIE czysty JSON: {"answer":"...","consensus":"full|partial|conflict","note":"krótko o zgodności/rozbieżności"}.',
  "W polu answer pisz pełną, gotową odpowiedź dla użytkownika (bez wzmianki o ekspertach).",
].join("\n");

function parseJudge(raw: string): { answer: string; consensus: CouncilReply["council"]["consensus"]; note: string } | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const consensus = ["full", "partial", "conflict"].includes(j.consensus) ? j.consensus : "partial";
    if (typeof j.answer !== "string" || !j.answer.trim()) return null;
    return { answer: j.answer.trim(), consensus, note: typeof j.note === "string" ? j.note : "" };
  } catch {
    return null;
  }
}

/**
 * Uruchom konsylium dla danej historii rozmowy. Zwraca syntezę + odpowiedzi
 * poszczególnych modeli i ocenę zgodności. Gdy dostępny jest mniej niż 2
 * dostawców, degraduje do pojedynczej odpowiedzi (consensus: "single").
 */
export async function askCouncil(history: Msg[]): Promise<CouncilReply> {
  const members = councilMembers(3);
  const userName = store.settings.userName || "Sir";

  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content || "";
  await prepareMemoryContext(lastUser).catch(() => {});
  const memberSys = MEMBER_SYSTEM(userName, memoryBlock());

  // Mniej niż 2 modele → nie ma czego radzić; jeden ekspert = zwykła odpowiedź.
  if (members.length < 2) {
    const only = members[0];
    const text = only ? await askMember(only, memberSys, history) : null;
    return {
      text: text || "Brak skonfigurowanego dostawcy AI. Dodaj klucz w ⚙ → AI.",
      tools: [],
      council: { members: only && text ? [{ label: only.label, text }] : [], consensus: "single", note: "" },
    };
  }

  // 1) Pytamy wszystkich równolegle.
  const raw = await Promise.all(members.map((m) => askMember(m, memberSys, history)));
  const answers = members
    .map((m, i) => ({ label: m.label, text: raw[i] }))
    .filter((x): x is { label: string; text: string } => !!x.text);

  if (answers.length === 0) {
    return { text: "Żaden z modeli konsylium nie odpowiedział — sprawdź klucze i sieć (⚙ → AI).", tools: [], council: { members: [], consensus: "single", note: "" } };
  }
  if (answers.length === 1) {
    return { text: answers[0].text, tools: [], council: { members: answers, consensus: "single", note: "Tylko jeden model odpowiedział." } };
  }

  // 2) Sędzia syntezuje (najwyżej oceniany dostawca z kluczem).
  const judge = members[0];
  const judgeHistory: Msg[] = [
    {
      role: "user",
      content:
        `Pytanie użytkownika:\n${lastUser}\n\n` +
        answers.map((a, i) => `=== Ekspert ${i + 1} ===\n${a.text}`).join("\n\n") +
        `\n\nZsyntezuj najlepszą odpowiedź i oceń zgodność. Zwróć sam JSON.`,
    },
  ];
  const judgeRaw = await askMember(judge, JUDGE_SYSTEM, judgeHistory);
  const parsed = judgeRaw ? parseJudge(judgeRaw) : null;

  if (!parsed) {
    // Sędzia zawiódł — oddaj najdłuższą (zwykle najbogatszą) odpowiedź eksperta.
    const best = [...answers].sort((a, b) => b.text.length - a.text.length)[0];
    return { text: best.text, tools: [], council: { members: answers, consensus: "partial", note: "Synteza niedostępna — pokazuję najpełniejszą odpowiedź." } };
  }

  return {
    text: parsed.answer,
    tools: [],
    council: { members: answers, consensus: parsed.consensus, note: parsed.note },
  };
}

// === Rada Strategiczna (Strateg/Krytyk/Sędzia) — runtime ===
// Wpięcie decisionEngine w prawdziwego dostawcę: jeden model (najlepszy dostępny) gra po kolei
// trzy role. Bez sieci/klucza → runner zwraca null, a engine degraduje do uczciwego fallbacku.

const ROLE_SYSTEM =
  "Jesteś częścią Rady Strategicznej asystenta JARVIS. Odpowiadasz po polsku, rzeczowo i krótko. " +
  "Podawaj wyłącznie wnioski — NIE pokazuj toku myślenia. Gdy proszą o JSON, zwróć sam JSON.";

/** Zbuduj RoleRunner z najlepszego dostępnego dostawcy (bez narzędzi, czyste rozumowanie). */
export function makeProviderRoleRunner(): RoleRunner {
  const member = councilMembers(1)[0];
  return async (_role, prompt) => {
    if (!member) return null;
    const apiKey = member.provider === "ollama" || member.provider === "webllm" ? "local" : orderedKeys(member.provider)[0];
    if (!apiKey) return null;
    try {
      const r = await withTimeout(
        PROVIDERS[member.provider].impl({
          system: ROLE_SYSTEM, webSearch: false, tools: [], history: [{ role: "user", content: prompt }],
          apiKey, model: member.model, proxyUrl: store.settings.proxyUrl?.trim() || undefined,
        }),
      );
      return (r.text || "").trim() || null;
    } catch {
      return null;
    }
  };
}

/** Runtime: doradź przy ważnej decyzji przez Radę (Strateg → Krytyk → Sędzia). */
export function decideWithCouncil(input: DecisionInput, runner: RoleRunner = makeProviderRoleRunner()): Promise<DecisionResult> {
  return runDecisionCouncil(input, runner);
}
