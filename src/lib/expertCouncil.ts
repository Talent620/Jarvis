// === Sprint 2 / Moduł 3: Rada Ekspertów (Multi-Agent Sparring) ===
// Uruchamiana hasłem głosowym „Narada:” lub przyciskiem w UI.
// Równolegle (Promise.all) uruchamia 3 wyspecjalizowane perspektywy:
//  1) Inżynier-Praktyk (wykonalność, techniczne pułapki),
//  2) Strateg-Finansista (koszt, czas, marża, ROI),
//  3) Sceptyczny Krytyk (co może pójść źle),
// i syntetyzuje wynik do jednego zwięzłego werdyktu (<= 30 s TTS + rozwijana karta 3 opinii w UI).
import { askModel } from "./brain";
import { formatForSpokenPolish } from "./soulModes";
import type { ChatMessage } from "../types";

export type ExpertId = "engineer" | "strategist" | "critic";

export interface ExpertSpec {
  id: ExpertId;
  label: string;
  focus: string;
  system: string;
}

export const EXPERT_ROLES: readonly ExpertSpec[] = [
  {
    id: "engineer",
    label: "🔧 Inżynier-Praktyk",
    focus: "wykonalność, techniczne pułapki",
    system:
      "Jesteś Inżynierem-Praktykiem w Radzie Ekspertów JARVIS. " +
      "Oceń WYŁĄCZNIE techniczną wykonalność, architekturę, czas wdrożenia i pułapki realizacyjne. " +
      "Odpowiedz po polsku w 2–3 konkretnych zdaniach, bez lania wody.",
  },
  {
    id: "strategist",
    label: "💰 Strateg-Finansista",
    focus: "koszt, czas, marża, ROI",
    system:
      "Jesteś Strategiem-Finansistą w Radzie Ekspertów JARVIS. " +
      "Oceń WYŁĄCZNIE koszt całkowity, czas zwrotu (ROI), marżę, koszt alternatywny i sens biznesowy. " +
      "Odpowiedz po polsku w 2–3 konkretnych zdaniach z liczbami lub widełkami, bez lania wody.",
  },
  {
    id: "critic",
    label: "🛡 Sceptyczny Krytyk",
    focus: "co może pójść źle",
    system:
      "Jesteś Sceptycznym Krytykiem w Radzie Ekspertów JARVIS. " +
      "Celowo szukaj ukrytych ryzyk, słabych założeń, błędów poznawczych i scenariuszy porażki (co może pójść źle). " +
      "Odpowiedz po polsku w 2–3 ostrych, rzeczowych zdaniach.",
  },
] as const;

export interface ExpertOpinion {
  id: ExpertId;
  label: string;
  text: string;
  ok: boolean;
  ms: number;
}

export interface ExpertCouncilResult {
  topic: string;
  verdict: string;
  /** Wersja mówiona pod TTS: max 3 krótkie zdania (~<=30 s), zero markdownu i URL-i. */
  spokenVerdict: string;
  opinions: ExpertOpinion[];
  /** Gotowy payload dla rozwijanej karty 3 opinii w Conversation.tsx. */
  council: NonNullable<ChatMessage["council"]>;
}

export type ExpertRunner = (system: string, userPrompt: string) => Promise<string>;

const NARADA_RE = /^(?:jarvis[, ]+)?(?:narada|rada ekspert[óo]w|zwo[łl]aj narad[ęe])(?:\s*[:—-]\s*|\s+)(.+)$/i;

/** Pure: wykryj komendę głosową/tekstową „Narada: <temat>” i zwróć temat narady. */
export function parseNaradaCommand(text: string): string | null {
  const m = NARADA_RE.exec((text || "").trim());
  if (!m) return null;
  const topic = (m[1] || "").trim();
  return topic.length >= 3 ? topic : null;
}

const SYNTHESIS_SYSTEM = [
  "Jesteś przewodniczącym Rady Ekspertów JARVIS.",
  "Otrzymujesz temat oraz 3 niezależne opinie: Inżyniera-Praktyka, Stratega-Finansisty i Sceptycznego Krytyka.",
  "Zsyntetyzuj je w JEDEN zwięzły, konkretny werdykt po polsku (MAKSYMALNIE 3 krótkie zdania — do 30 sekund odsłuchu głosowego):",
  "1) Jasna rekomendacja (robić / poprawić / odpuścić).",
  "2) Najważniejszy argument za i największe ryzyko do zabezpieczenia.",
  "3) Jeden konkretny następny krok.",
  "ZERO list punktowanych, ZERO markdowna, ZERO wstępów.",
].join("\n");

const RISK_RE = /(ryzyk|pu[łl]apk|nie op[łl]aca|odpu[śs][ćc]|strata|zbyt drog|blokad|porażk|uwaga|grozi)/i;
const POSITIVE_RE = /(wykonaln|op[łl]aca|wysoki roi|warto|dobry|zysk|szybko|proste|sensown)/i;

/** Pure: oceń poziom zgodności między 3 opiniami. */
export function assessExpertConsensus(opinions: ExpertOpinion[]): NonNullable<ChatMessage["council"]>["consensus"] {
  const valid = opinions.filter((o) => o.ok && o.text.trim());
  if (valid.length <= 1) return "single";
  const hasPositive = valid.some((o) => o.id !== "critic" && POSITIVE_RE.test(o.text));
  const hasRisk = valid.some((o) => RISK_RE.test(o.text));
  if (hasPositive && hasRisk) return "conflict";
  if (valid.length === 3 && !hasRisk) return "full";
  return "partial";
}

/** Pure: deterministyczny fallback syntezy, jeśli model syntezujący padnie. */
export function fallbackSynthesizeVerdict(topic: string, opinions: ExpertOpinion[]): string {
  const valid = opinions.filter((o) => o.ok && o.text.trim());
  if (!valid.length) return `Rada Ekspertów nie uzyskała odpowiedzi dla tematu: ${topic}.`;
  const lead = valid
    .map((o) => formatForSpokenPolish(o.text, 1))
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  return formatForSpokenPolish(lead, 3) || `Rada zebrała ${valid.length} opinie w sprawie: ${topic}.`;
}

const defaultRunner: ExpertRunner = (system, prompt) =>
  askModel({ system, history: [{ role: "user", content: prompt }], webSearch: false, tools: [] });

/**
 * Uruchom Radę Ekspertów równolegle (`Promise.all`) dla 3 ról i zsyntetyzuj jeden werdykt <= 30 s.
 */
export async function runExpertCouncil(
  topic: string,
  opts: { runner?: ExpertRunner; synthesizer?: ExpertRunner; onProgress?: (step: string) => void } = {},
): Promise<ExpertCouncilResult> {
  const cleanTopic = (topic || "").trim();
  if (!cleanTopic) throw new Error("Podaj temat dla Rady Ekspertów (np. „Narada: czy kupić serwer GPU?”).");

  const runner = opts.runner || defaultRunner;
  const synthesizer = opts.synthesizer || runner;
  opts.onProgress?.("🏛 Rada Ekspertów — równoległa analiza 3 specjalistów…");

  const opinions: ExpertOpinion[] = await Promise.all(
    EXPERT_ROLES.map(async (role) => {
      const t0 = Date.now();
      try {
        const raw = await runner(role.system, `Temat narady: ${cleanTopic}`);
        const text = (raw || "").trim();
        return {
          id: role.id,
          label: role.label,
          text: text || "Brak uwagi od tego eksperta.",
          ok: Boolean(text),
          ms: Date.now() - t0,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          id: role.id,
          label: role.label,
          text: `Ekspert chwilowo niedostępny (${msg.slice(0, 80)}).`,
          ok: false,
          ms: Date.now() - t0,
        };
      }
    }),
  );

  const okCount = opinions.filter((o) => o.ok).length;
  if (okCount === 0) {
    throw new Error("Żaden z 3 ekspertów nie odpowiedział — sprawdź konfigurację dostawcy AI.");
  }

  opts.onProgress?.("🏛 Rada Ekspertów — synteza werdyktu…");
  const synthPrompt = [
    `Temat: ${cleanTopic}`,
    ...opinions.map((o) => `${o.label}: ${o.text}`),
  ].join("\n\n");

  let verdict: string;
  try {
    const rawVerdict = (await synthesizer(SYNTHESIS_SYSTEM, synthPrompt))?.trim() || "";
    verdict = rawVerdict || fallbackSynthesizeVerdict(cleanTopic, opinions);
  } catch {
    verdict = fallbackSynthesizeVerdict(cleanTopic, opinions);
  }

  const spokenVerdict = formatForSpokenPolish(verdict, 3).slice(0, 380) || fallbackSynthesizeVerdict(cleanTopic, opinions);
  const consensus = assessExpertConsensus(opinions);

  return {
    topic: cleanTopic,
    verdict,
    spokenVerdict,
    opinions,
    council: {
      members: opinions.map((o) => ({ label: o.label, text: o.text })),
      consensus,
      note: `Rada Ekspertów (${okCount}/3 opinie) — temat: ${cleanTopic}`,
    },
  };
}
