// === Wycena projektu JARVIS — prosto i uczciwie, z realnych metryk kodu ===
// Liczy: ile by KOSZTOWAŁO odtworzenie (realna praca), ile realnie dostaniesz JUTRO (szybka
// sprzedaż „jak jest", bez użytkowników/marki), czas budowy i trudność. Czyste funkcje —
// odświeżanie „raz dziennie" robi cienki cache w localStorage.

export interface CodeStats { modules: number; components: number; tests: number; files: number; loc: number }

export interface Valuation {
  loc: number; modules: number; components: number; tests: number;
  hours: number;            // szacowana praca (godziny)
  months: number;          // w przeliczeniu na 1 osobę na pełny etat
  replMinPln: number;       // koszt ODTWORZENIA (dolna)
  replMaxPln: number;       // koszt odtworzenia (górna)
  quickLowPln: number;      // ile REALNIE jutro (szybka sprzedaż „jak jest")
  quickHighPln: number;
  difficulty: number;       // 1–10
  difficultyLabel: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, step: number) => Math.round(n / step) * step;

/** Pure: pełna wycena z metryk kodu. */
export function valuate(s: CodeStats): Valuation {
  const loc = Math.max(0, s.loc || 0);
  // ~20 linii dobrej produkcyjnej TS/h (z myśleniem, testami, debugiem).
  const hours = Math.round(loc / 20);
  const months = +(hours / 160).toFixed(1); // 160 h = miesiąc pełnego etatu
  // Koszt odtworzenia: stawka mid–senior PL (120–180 zł/h).
  const replMinPln = round(hours * 120, 1000);
  const replMaxPln = round(hours * 180, 1000);
  // Szybka sprzedaż JUTRO „jak jest" (bez użytkowników, marki, dystrybucji) = ułamek odtworzenia.
  const quickLowPln = round(clamp(replMinPln * 0.03, 2000, 30000), 500);
  const quickHighPln = round(clamp(replMaxPln * 0.08, 6000, 80000), 500);
  // Trudność z rozmiaru i szerokości (moduły + komponenty).
  const breadth = (s.modules || 0) + (s.components || 0);
  const difficulty = clamp(Math.round(4 + Math.log10(Math.max(1, loc)) + breadth / 120), 1, 10);
  const difficultyLabel =
    difficulty >= 9 ? "ekstremalnie trudny (poziom zespołu/agencji)" :
    difficulty >= 7 ? "bardzo trudny (senior + dużo czasu)" :
    difficulty >= 5 ? "trudny (doświadczony programista)" : "średni";
  return { loc, modules: s.modules || 0, components: s.components || 0, tests: s.tests || 0, hours, months, replMinPln, replMaxPln, quickLowPln, quickHighPln, difficulty, difficultyLabel };
}

/** Metryki z builda (lub zera w dev). */
export function buildStats(): CodeStats {
  try { return __PROJECT_STATS__; } catch { return { modules: 0, components: 0, tests: 0, files: 0, loc: 0 }; }
}

// --- Odświeżanie raz dziennie (cache w localStorage) ---
const KEY = "jarvis.valuation.v1";
const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export interface DailyValuation extends Valuation { day: string; refreshedAt: number }

/** Wycena z dziennym cache — odświeża się raz na dobę (przy pierwszym wejściu danego dnia). */
export function dailyValuation(now = Date.now()): DailyValuation {
  const today = dayKey(now);
  try {
    const cached = JSON.parse(localStorage.getItem(KEY) || "null") as DailyValuation | null;
    if (cached && cached.day === today) return cached;
  } catch { /* przelicz */ }
  const fresh: DailyValuation = { ...valuate(buildStats()), day: today, refreshedAt: now };
  try { localStorage.setItem(KEY, JSON.stringify(fresh)); } catch { /* prywatny tryb */ }
  return fresh;
}

const zl = (n: number) => `${Math.round(n).toLocaleString("pl-PL")} zł`;
/** Pure: zakres w zł („15 000–40 000 zł"). */
export function plnRange(min: number, max: number): string {
  return `${zl(min)}–${zl(max)}`;
}
