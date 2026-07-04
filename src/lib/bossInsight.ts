// === Transparentność i antycypacja Szefa — 3 nowości ===
//  1) Skalibrowana PEWNOŚĆ (mówiona, gdy istotna): „pewność ~80% — potwierdź".
//  2) CZARNA SKRZYNKA: na żądanie wyjaśnia, którym mózgiem odpowiedział, czy zweryfikował,
//     co poprawił (pełna przejrzystość agenta).
//  3) PREDYKCYJNY krok dalej: przewiduje sensowne następne działanie i sam je proponuje.
// Wszystko czyste i testowalne; wywołania modelu/głos robi caller (pętla rozmowy).
import { estimateConfidence } from "./confidence";

export type VerifyResult = "pass" | "fixed" | "none";

/** Skalibrowana pewność finalnej odpowiedzi (0–100, zaokrąglona do 5%). */
export function confidencePct(text: string, verify: VerifyResult): number {
  let c = estimateConfidence(text, "complex"); // 0..1
  if (verify === "pass") c = Math.min(1, c + 0.1); // przeszła drugi, niezależny test
  // "fixed" → bierzemy pewność poprawionej treści (bez bonusu); "none" → sama heurystyka
  return Math.round((c * 100) / 5) * 5;
}

/** Czy polecenie dotyczy akcji nieodwracalnej (wtedy pewność jest szczególnie ważna). */
export function isRiskyCommand(text: string): boolean {
  // Bez końcowego \b — to rdzenie poleceń („wyśl"→„wyślij"), a polskie końcówki rwą ASCII-owe \b.
  return /\b(wy[śs]l|wys[łl]a[ćc]|zadzwo|sms|przele|usu[ńn]|skasuj|opublikuj|\bkup|zap[łl]a[ćc]|zarejestruj|za[łl][oó][żz] konto|zam[óo]w)/i.test(text || "");
}

/** Krótka przedmowa o pewności — TYLKO gdy istotna (ryzyko albo naprawdę niska). Inaczej "". */
export function confidencePreface(pct: number, risky: boolean): string {
  if (risky && pct < 80) return `Pewność ~${pct}% — potwierdź, zanim wykonam.`;
  if (pct < 55) return `Nie jestem w pełni pewien (~${pct}%).`;
  return "";
}

// --- Czarna skrzynka (wyjaśnialność) ---
const EXPLAIN = /(dlaczego (tak|to)|jak to zrobi|wyja[śs]nij|sk[ąa]d (to )?wiesz|czym (to )?sprawdzi|jakim modelem|kt[óo]ry m[óo]zg|jak doszed[łl]e[śs]|na jakiej podstawie)/i;

export function isExplainRequest(text: string): boolean {
  return EXPLAIN.test(text || "");
}

export interface BossTrace {
  brain: string;   // czytelna nazwa mózgu (dostawca)
  verify: VerifyResult;
  conf: number;    // 0–100
  ms: number;      // czas odpowiedzi
  tools: string[]; // użyte narzędzia
}

/** Wyjaśnij ostatnie działanie po ludzku (czarna skrzynka). Pure. */
export function explainTrace(t: BossTrace): string {
  const sec = (t.ms / 1000).toFixed(1);
  const ver =
    t.verify === "fixed" ? "Sprawdziłem ją drugim, mocniejszym modelem i poprawiłem." :
    t.verify === "pass" ? "Sprawdziłem ją drugim modelem — była poprawna." :
    "To nie było trudne, więc nie weryfikowałem dodatkowo.";
  const tools = t.tools && t.tools.length ? ` Użyłem narzędzi: ${t.tools.join(", ")}.` : "";
  return `Ostatnią odpowiedź dał mózg: ${t.brain}. ${ver} Moja pewność to ~${t.conf}%. Zajęło ~${sec} s.${tools}`;
}

// --- Predykcyjny krok dalej (antycypacja) ---
const NEXT: [RegExp, string][] = [
  [/dodaj\w* zadani|nowe zadanie/i, "ustawić przypomnienie do tego zadania"],
  [/znajd[źz][\s\S]*lead|szukaj lead|wyszukaj lead/i, "zadzwonić do najlepszego leada"],
  [/(napisz|szkic|przygotuj)[\s\S]*(mail|e-mail|wiadomo[śs][ćc])/i, "wysłać tę wiadomość"],
  [/zaplanuj|rozpisz plan|plan na/i, "rozbić plan na konkretne zadania"],
  [/przet[łl]umacz/i, "zapisać to tłumaczenie w notatkach"],
  [/najtaniej|gdzie kupi[ćc]|por[óo]wnaj cen/i, "otworzyć najtańszą ofertę"],
  [/(um[óo]w|spotkani|kalendarz)/i, "ustawić przypomnienie przed spotkaniem"],
  [/zapami[ęe]taj|zapisz w pami[ęe]ci|do profilu/i, "dopisać to do Twojego profilu"],
];

/** Przewidywany, sensowny następny krok (oferta, nie automat). Null, gdy brak. Pure. */
export function predictNext(text: string): string | null {
  for (const [re, label] of NEXT) if (re.test(text || "")) return label;
  return null;
}
