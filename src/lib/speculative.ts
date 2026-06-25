// Spekulacja Refleks→Kora (Zadanie 9, draft-then-verify). Lokalny model robi szybki draft
// (streaming → użytkownik widzi tekst od razu), równolegle Kora weryfikuje. Gdy odpowiedzi
// zgodne — zostaje tani lokalny draft; gdy rozbieżne — bierzemy korektę Kory. Czyste funkcje
// (rozbieżność/decyzja) testowalne; orkiestracja przyjmuje wstrzykiwalne runnery (też testowalna).

import type { JarvisReply } from "./providers/types";

const STOP = new Set(["i", "oraz", "the", "a", "to", "że", "jest", "na", "w", "z", "do", "się", "nie", "o", "po", "co", "jak"]);

// Lekki stem po prefiksie (6 znaków) — tnie polską odmianę przez przypadki
// („stolicą"/„stolica" → „stolic"), żeby parafraza nie liczyła się jako rozbieżność.
function tokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż\s]/g, " ") // S9-safe: bez /u i \p{L}
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => w.slice(0, 6)),
  );
}

/** Rozbieżność treści 0..1 (1 - Jaccard zbiorów słów). 0 = identyczne, 1 = rozłączne. */
export function divergence(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union ? 1 - inter / union : 0;
}

/** Czy podmienić lokalny draft na odpowiedź Kory (pusty draft lub rozbieżność ≥ próg). */
export function shouldCorrect(localText: string, cortexText: string, threshold = 0.5): boolean {
  if (!localText.trim()) return true;
  if (!cortexText.trim()) return false;
  // Draft zbyt krótki/stopwordowy (zero tokenów) — Jaccard nic nie powie; zaufaj weryfikatorowi (Kora).
  if (tokens(localText).size === 0) return true;
  return divergence(localText, cortexText) >= threshold;
}

export interface SpeculativeResult {
  reply: JarvisReply;
  corrected: boolean; // true = wzięto korektę Kory
  usedCortex: boolean; // czy Kora w ogóle odpowiedziała
}

/**
 * Orkiestracja spekulacji. `runLocal`/`runCortex` wstrzykiwane (testy + reużycie realnych
 * adapterów w brain.ts). Draft streamuje przez onToken; po werdykcie ewentualnie podmienia tekst.
 */
export async function speculativeAnswer(opts: {
  runLocal: (onToken?: (delta: string) => void) => Promise<JarvisReply>;
  runCortex: () => Promise<JarvisReply>;
  onToken?: (fullText: string) => void;
  threshold?: number;
}): Promise<SpeculativeResult> {
  const threshold = opts.threshold ?? 0.5;
  let draft = "";
  const localOnTok = opts.onToken ? (d: string) => { draft += d; opts.onToken!(draft); } : undefined;

  const localP = opts.runLocal(localOnTok).then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e }));
  const cortexP = opts.runCortex().then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e }));
  const [local, cortex] = await Promise.all([localP, cortexP]);

  if (cortex.ok) {
    const localText = local.ok ? local.r.text : "";
    if (local.ok && !shouldCorrect(localText, cortex.r.text, threshold)) {
      // Zgodne — zostaw tani lokalny draft (zero realnego kosztu chmury w odpowiedzi).
      return { reply: { ...local.r, via: "ollama", fellBack: false }, corrected: false, usedCortex: true };
    }
    // Rozbieżne lub brak draftu — bierzemy korektę Kory; pokaż finalny tekst.
    if (opts.onToken) opts.onToken(cortex.r.text);
    return { reply: cortex.r, corrected: true, usedCortex: true };
  }

  // Kora padła — draft lokalny finalny (graceful).
  if (local.ok) return { reply: { ...local.r, via: "ollama", fellBack: false }, corrected: false, usedCortex: false };
  throw local.ok ? new Error("brak odpowiedzi") : (local as { e: unknown }).e;
}
