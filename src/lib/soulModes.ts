// === Sprint 2 / Moduł 1: Protokół Mówionej Polszczyzny + 3 Tryby Osobowości ===
// Czysty, testowalny moduł (Refleks/Kora + UI + voiceLoop).

export type PersonalityMode = "AUTO" | "BOJOWY" | "KUMPEL" | "ADWOKAT_DIABLA";
export type ResolvedPersonality = "BOJOWY" | "KUMPEL" | "ADWOKAT_DIABLA";

export interface PersonalityMeta {
  id: ResolvedPersonality;
  label: string;
  badge: string;
  shortHint: string;
  prompt: string;
}

export const VOICE_MODE_DIRECTIVE = [
  "PROTOKÓŁ MÓWIONEJ POLSZCZYZNY (voice_mode AKTYWNY):",
  "- Odpowiadaj naturalną, mówioną polszczyzną: MAKSYMALNIE 2–3 krótkie, zwięzłe zdania na turę.",
  "- ZERO list punktowanych, ZERO markdowna (gwiazdek, nagłówków, bloków kodu), ZERO czytania adresów URL.",
  "- Pisz pod naturalny rytm głosu TTS (krótkie frazy, oddech po kropce), zakładając że użytkownik może Ci przerwać w dowolnym momencie (barge-in).",
].join("\n");

export const PERSONALITY_MODES: Record<ResolvedPersonality, PersonalityMeta> = {
  BOJOWY: {
    id: "BOJOWY",
    label: "Bojowy",
    badge: "⚔",
    shortHint: "kod, awarie, szybka akcja",
    prompt:
      "TRYB OSOBOWOŚCI: BOJOWY (kod, awarie, szybka akcja). ZERO wstępów i uprzejmości. " +
      "Podawaj od razu konkretną diagnozę, gotową komendę, poprawkę lub schemat działania. Maksimum konkretu na słowo.",
  },
  KUMPEL: {
    id: "KUMPEL",
    label: "Kumpel",
    badge: "🤝",
    shortHint: "luźna rozmowa, trasa",
    prompt:
      "TRYB OSOBOWOŚCI: KUMPEL (luźna rozmowa, trasa). Mów naturalnie, z wyczuciem humoru i luzem, jak ogarnięty znajomy. " +
      "Unikaj lizusostwa i sztucznych pochwał; zadawaj trafne, krótkie pytania zwrotne, gdy rozmowa na to zasługuje.",
  },
  ADWOKAT_DIABLA: {
    id: "ADWOKAT_DIABLA",
    label: "Adwokat Diabła",
    badge: "😈",
    shortHint: "decyzje, wydatki, umowy, pomysły",
    prompt:
      "TRYB OSOBOWOŚCI: ADWOKAT DIABŁA (decyzje, wydatki, umowy, pomysły). Nie przytakuj automatycznie. " +
      "Celowo szukaj ukrytych kosztów, słabych założeń, pułapek w umowach i ryzyk (co może pójść nie tak), " +
      "zanim użytkownik zatwierdzi pomysł lub wydatek. Zakończ trzeźwą rekomendacją: robić, poprawić czy odpuścić.",
  },
};

const BOJOWY_RE =
  /(b[łl][ąa]d|error|exception|stack ?trace|awari|pad[łl]o|nie dzia[łl]a|crash|fix|napraw|debug|deploy|docker|git\b|npm\b|bash|sql|api\b|http ?[45]\d\d|serwer|kod\b|skrypt|komend|build|testy|ci\/cd|szybko|pilne|alarm)/i;

const ADWOKAT_RE =
  /(decyzj|wydatek|wydatki|koszt|umow[aęy]|kontrakt|pomys[łl]|zainwest|inwestycj|kupi[ćc]|kupno|leasing|kredyt|wycen|mar[żz]|bud[żz]et|biznesplan|op[łl]aca|warto\b|ryzyk|oferta|negocj|wsp[óo][łl]prac|czy powinienem|co my[śs]lisz o pomy[śs]le|podpisa[ćc])/i;

const KUMPEL_RE =
  /(co tam|jak leci|siema|hej\b|cze[śs][ćc]|w trasie|jad[ęe]|samoch[óo]d|pogadajmy|nudzi|weekend|film|muzyk|kaw[aęy]|obiad|wakacj|urlop|[żz]art|kawa[łl]|jak min[ąa][łl]|dobranoc|dzie[ńn] dobry)/i;

/** Pure: automatyczny dobór trybu osobowości przez router Refleks/Kora na podstawie intencji. */
export function detectPersonalityMode(userText: string): ResolvedPersonality {
  const t = (userText || "").trim();
  if (!t) return "KUMPEL";
  if (ADWOKAT_RE.test(t)) return "ADWOKAT_DIABLA";
  if (BOJOWY_RE.test(t)) return "BOJOWY";
  if (KUMPEL_RE.test(t)) return "KUMPEL";
  return t.length <= 48 && /[!?]$/.test(t) ? "BOJOWY" : "KUMPEL";
}

/** Pure: rozstrzygnij aktywny tryb osobowości (ręczny wybór w UI ma pierwszeństwo przed AUTO). */
export function resolvePersonalityMode(
  configured: PersonalityMode | string | undefined,
  userText: string,
): ResolvedPersonality {
  if (configured === "BOJOWY" || configured === "KUMPEL" || configured === "ADWOKAT_DIABLA") {
    return configured;
  }
  return detectPersonalityMode(userText);
}

/** Pure: rozpoznaj głosową komendę przełączenia trybu osobowości. */
export function parseVoicePersonalityCommand(text: string): PersonalityMode | null {
  const t = (text || "").trim().toLowerCase();
  if (!/(tryb|prze[łl][ąa]cz|w[łl][ąa]cz|zmie[ńn])/.test(t)) return null;
  if (/bojow/.test(t)) return "BOJOWY";
  if (/kumpel|kumpl/.test(t)) return "KUMPEL";
  if (/adwokat|diab[łl]/.test(t)) return "ADWOKAT_DIABLA";
  if (/auto/.test(t) && /(osobow|tryb)/.test(t)) return "AUTO";
  return null;
}

/** Pure: wyczyść i skróć wypowiedź do naturalnej mówionej polszczyzny (max 2–3 zdania pod TTS). */
export function formatForSpokenPolish(raw: string, maxSentences = 3): string {
  let s = String(raw || "");
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`([^`]*)`/g, "$1");
  s = s.replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/https?:\/\/\S+/gi, "");
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s*[-*+•]\s+/gm, "");
  s = s.replace(/^\s*\d+[.)]\s+/gm, "");
  s = s.replace(/[*_~]+/g, "");
  s = s.replace(/\s*\n+\s*/g, ". ");
  s = s.replace(/\.{2,}/g, ".").replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  if (!s) return "";
  const sentences = s.match(/[^.!?]+[.!?]?/g)?.map((x) => x.trim()).filter(Boolean) || [s];
  return sentences.slice(0, Math.max(1, maxSentences)).join(" ").trim();
}

/** Pure: zbuduj blok instrukcji duszy (osobowość + opcjonalny voice_mode) do promptu systemowego. */
export function buildSoulPromptBlock(opts: {
  mode?: PersonalityMode | string;
  userText?: string;
  voiceMode?: boolean;
}): { mode: ResolvedPersonality; block: string } {
  const mode = resolvePersonalityMode(opts.mode, opts.userText || "");
  const parts = [PERSONALITY_MODES[mode].prompt];
  if (opts.voiceMode) parts.push(VOICE_MODE_DIRECTIVE);
  return { mode, block: parts.join("\n\n") };
}
