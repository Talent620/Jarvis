// === Dziennik Predykcji (Prediction Ledger) — silnik v2 ===
// Zamyka pętlę osobistej inteligencji: obserwacja → FALSYFIKOWALNA prognoza (z terminem,
// pewnością, założeniami i zamrożonym stanem wejściowym) → działanie użytkownika → realny wynik
// → deterministyczny werdykt (DOWÓD zapisany OSOBNO od prognozy) → kalibracja per encja →
// lepsza NASTĘPNA decyzja (okno ostrzeżenia i pewność uczone per klient, z ograniczonym krokiem).
//
// Zasady twarde:
// 1. Treści/warunków prognozy NIE WOLNO przepisywać po utworzeniu — wynik żyje w `evidence`,
//    zapisywanym dokładnie raz. Model językowy nie ma tu nic do gadania: werdykt wydaje
//    deterministyczna reguła z realnych danych (daty kontaktu, status sprawy).
// 2. Zero sieci, zero efektów ubocznych — czyste funkcje (adapter store'a: predictionCycle.ts).
// 3. Uczenie ma bezpieczniki: minimum obserwacji, ograniczony krok, twarde granice, możliwość
//    wyłączenia (learningEnabled=false → wartości domyślne) i wyzerowania (czyszczenie historii).
// 4. S9-safe: bez /u, \p, lookbehind; indeksowanie po ID (Map), bez kwadratowych pętli.
//
// Uczciwość werdyktów: prognoza zaniedbania powstaje TYLKO, gdy termin follow-upu już REALNIE
// minął. Pytanie brzmi wyłącznie: przerwa się pogłębi (correct), użytkownik zdąży zareagować
// (prevented), czy sprawa zamknie się zanim to się rozstrzygnie (moot).

import type { PredictionRecord, PredictionEvidence, PredictionVerdict, PredictionInputState, LeadStatus } from "../types";

const DAY = 86_400_000;
const DEFAULT_WINDOW_DAYS = 7;
const MIN_WINDOW_DAYS = 3;
const MAX_WINDOW_DAYS = 21;
/** Wersja logiki prognozującej — podbijana przy każdej zmianie reguł (celność liczona per wersja). */
export const PREDICTION_LOGIC_VERSION = 2;
/** Kalibracja pewności: start, granice i krok (EWMA) — jeden przypadek NIE przestawia gwałtownie. */
const BASE_CONFIDENCE = 0.7;
const MIN_CONFIDENCE = 0.35;
const MAX_CONFIDENCE = 0.95;
const CONFIDENCE_STEP = 0.15; // maks. przesunięcie za jedno rozstrzygnięcie: step × odległość od celu
const MIN_OBSERVATIONS = 2; // poniżej tego progu żadnego uczenia — wartości domyślne, bez zgadywania
/** Ograniczony rozmiar dziennika (S9): pending nigdy nie wypada; rozstrzygnięte — najnowsze per encja. */
const MAX_RESOLVED_PER_ENTITY = 12;
const MAX_TOTAL_RECORDS = 500;

const TERMINAL_STATUSES: LeadStatus[] = ["won", "lost"];
const r2 = (x: number): number => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Pure: bieżący werdykt rekordu — pending, dopóki nie ma DOWODU (evidence). */
export function verdictOf(r: PredictionRecord): PredictionVerdict {
  return r.evidence ? r.evidence.verdict : "pending";
}

/** Pure: rozstrzygnięcia LICZĄCE SIĘ do uczenia/statystyk — bez pending i bez zakwestionowanych
 *  przez użytkownika dowodów (oznaczenie „dowód błędny" wyklucza werdykt z uczenia, rekord zostaje). */
function countableResolved(records: PredictionRecord[], entityId?: string): PredictionRecord[] {
  return (records || []).filter(
    (r) => r.kind === "relationship_neglect"
      && (entityId == null || r.entityId === entityId)
      && r.evidence != null
      && r.evidence.disputedAt == null,
  );
}

/**
 * Pure: ile dni okna ostrzeżenia dać TEJ relacji, z JEJ własnej historii (nie globalnej reguły).
 * Bezpieczniki uczenia: <MIN_OBSERVATIONS rozstrzygnięć → domyślne okno; krok ograniczony (-2 dni);
 * twarde granice [MIN, MAX]; learningEnabled=false → zawsze domyślne. Dodatkowo Finanse podnoszą
 * stawkę: klient z projektem czekającym na płatność dostaje okno krótsze o 2 dni (zaniedbanie
 * kosztuje realne pieniądze) — również ograniczone od dołu.
 */
export function learnedWindowDays(
  records: PredictionRecord[],
  entityId: string,
  opts?: { learningEnabled?: boolean; awaitingPaymentAmount?: number },
): number {
  const learningEnabled = opts?.learningEnabled !== false;
  let window = DEFAULT_WINDOW_DAYS;
  if (learningEnabled) {
    const resolved = countableResolved(records, entityId).filter((r) => verdictOf(r) !== "moot");
    if (resolved.length >= MIN_OBSERVATIONS) {
      const preventedShare = resolved.filter((r) => verdictOf(r) === "prevented").length / resolved.length;
      // Klient reagujący po ostrzeżeniu → ostrzegaj pilniej (widać, że działa). Klient, u którego
      // przerwy po prostu bywają → zostaw standard (to jego naturalny rytm, nie przycinaj sztucznie).
      if (preventedShare >= 0.6) window = DEFAULT_WINDOW_DAYS - 2;
    }
  }
  if ((opts?.awaitingPaymentAmount || 0) > 0) window -= 2; // Finanse: czekająca płatność = wyższa stawka
  return clamp(window, MIN_WINDOW_DAYS, MAX_WINDOW_DAYS);
}

/**
 * Pure: skalibrowana pewność prognozy dla encji — EWMA po chronologicznych rozstrzygnięciach
 * (correct→cel 1, prevented→cel 0; moot pomijane — nic nie mówi o trafności). Ograniczony krok
 * (CONFIDENCE_STEP), twarde granice, minimum obserwacji, wyłączalne. Seria błędów (prevented,
 * czyli ostrzeżenie „nadgorliwe") obniża pewność stopniowo — nigdy skokowo po jednym przypadku.
 */
export function calibratedConfidence(
  records: PredictionRecord[],
  entityId: string,
  opts?: { learningEnabled?: boolean },
): number {
  if (opts?.learningEnabled === false) return BASE_CONFIDENCE;
  const resolved = countableResolved(records, entityId)
    .filter((r) => verdictOf(r) !== "moot")
    .sort((a, b) => (a.evidence!.observedAt - b.evidence!.observedAt));
  if (resolved.length < MIN_OBSERVATIONS) return BASE_CONFIDENCE;
  let conf = BASE_CONFIDENCE;
  for (const r of resolved) {
    const target = verdictOf(r) === "correct" ? 1 : 0;
    conf += CONFIDENCE_STEP * (target - conf);
  }
  return r2(clamp(conf, MIN_CONFIDENCE, MAX_CONFIDENCE));
}

/** Pure: czy założyć NOWĄ predykcję zaniedbania dla encji? Tylko gdy realnie overdue I nie ma już
 *  czekającej (pending) predykcji dla niej. Rozstrzygnięte rekordy NIE blokują nowej prognozy na
 *  nowy okres — stara, zamknięta sprawa nie zasłania świeżego ryzyka. */
export function shouldRecordNeglectPrediction(records: PredictionRecord[], entityId: string, overdue: boolean): boolean {
  if (!overdue) return false;
  return !(records || []).some((r) => r.entityId === entityId && r.kind === "relationship_neglect" && !r.evidence);
}

export interface RecordPredictionOpts {
  id: string;
  now: number;
  records: PredictionRecord[];
  lastContactedAt?: number;
  leadStatus?: LeadStatus;
  /** Suma kwot projektów klienta w statusie „oczekuje płatności" (Finanse) — podnosi stawkę. */
  awaitingPaymentAmount?: number;
  learningEnabled?: boolean;
}

/** Pure: zbuduj nową FALSYFIKOWALNĄ predykcję zaniedbania — kompletny rekord audytowalny:
 *  zamrożony stan wejściowy, mierzalne kryterium sukcesu, pewność, założenia, źródła, przesłanki. */
export function recordNeglectPrediction(entityId: string, entityLabel: string, opts: RecordPredictionOpts): PredictionRecord {
  const learnedFrom = countableResolved(opts.records || [], entityId).filter((r) => verdictOf(r) !== "moot").length;
  const windowDays = learnedWindowDays(opts.records || [], entityId, {
    learningEnabled: opts.learningEnabled,
    awaitingPaymentAmount: opts.awaitingPaymentAmount,
  });
  const confidence = calibratedConfidence(opts.records || [], entityId, { learningEnabled: opts.learningEnabled });
  const checkAt = opts.now + windowDays * DAY;
  const daysSince = opts.lastContactedAt != null ? Math.max(0, Math.round((opts.now - opts.lastContactedAt) / DAY)) : null;
  const awaiting = opts.awaitingPaymentAmount || 0;
  const basis = [
    daysSince != null ? `ostatni kontakt: ${daysSince} dni temu` : "brak zapisanego kontaktu",
    `okno ostrzeżenia: ${windowDays} dni (${learnedFrom >= MIN_OBSERVATIONS && opts.learningEnabled !== false ? `uczone z ${learnedFrom} rozstrzygnięć tego klienta` : "domyślne"})`,
    ...(awaiting > 0 ? [`projekt czeka na płatność: ${Math.round(awaiting).toLocaleString("pl-PL")} zł — zaniedbanie kosztuje realne pieniądze (okno skrócone)`] : []),
  ];
  const inputState: PredictionInputState = {
    ...(opts.lastContactedAt != null ? { lastContactedAt: opts.lastContactedAt } : {}),
    ...(opts.leadStatus ? { leadStatus: opts.leadStatus } : {}),
    ...(awaiting > 0 ? { awaitingPaymentAmount: r2(awaiting) } : {}),
  };
  return {
    id: opts.id,
    kind: "relationship_neglect",
    logicVersion: PREDICTION_LOGIC_VERSION,
    entityId,
    entityLabel,
    madeAt: opts.now,
    inputState,
    claim: `Jeśli w ciągu ${windowDays} dni nie skontaktujesz się z „${entityLabel}”, przerwa w kontakcie się pogłębi.`,
    successCriterion: `correct: do terminu nie pojawi się nowy kontakt (lastContactedAt) i sprawa pozostanie otwarta; prevented: kontakt nastąpi po utworzeniu prognozy, a przed terminem; moot: sprawa zamknie się (won/lost/usunięta) przed terminem.`,
    checkAt,
    confidence,
    assumptions: [
      "data ostatniego kontaktu w CRM jest kompletna (kontakt poza JARVISEM może nie być zapisany)",
      "zamknięcie sprawy (won/lost) unieważnia pytanie o zaniedbanie",
    ],
    sources: [
      "CRM: lead.lastContactedAt",
      "CRM: lead.status",
      ...(awaiting > 0 ? ["Finanse: projekty w statusie „oczekuje płatności”"] : []),
    ],
    basis,
  };
}

export interface EntityFacts {
  lastContactedAt?: number;
  status?: LeadStatus;
}

export interface ResolveOpts {
  /** true = `factsByEntity` obejmuje WSZYSTKIE istniejące encje (pełny cykl aplikacji) — wtedy
   *  brakujący wpis oznacza encję USUNIĘTĄ (werdykt moot). false/brak = częściowa wiedza
   *  (brakujący wpis → zostaw pending, nie zgaduj). */
  factsComplete?: boolean;
  /** Do zapisu confidenceAfterResolution — stan uczenia. */
  learningEnabled?: boolean;
}

/**
 * Pure: rozstrzygnij prognozy, których czas nadszedł (albo sprawa zamknęła się wcześniej), na
 * bazie REALNYCH danych. DOWÓD zapisywany dokładnie raz, OSOBNO od treści prognozy (evidence);
 * pola prognozy pozostają bajt w bajt nietknięte. Zamknięta prognoza NIGDY nie otwiera się
 * ponownie. Cofnięty zegar nie tworzy fałszywego sukcesu: „correct" wymaga now ≥ checkAt, a
 * „prevented" — kontaktu w oknie (madeAt, checkAt] niezależnie od bieżącego zegara.
 * Idempotentne: brak zmian → zwraca TĘ SAMĄ referencję tablicy (wołający nie zapisuje store).
 */
export function resolveDuePredictions(
  records: PredictionRecord[],
  now: number,
  factsByEntity: Record<string, EntityFacts | undefined>,
  opts?: ResolveOpts,
): PredictionRecord[] {
  const list = records || [];
  let changed = false;
  // Kalibracja per encja liczona narastająco W TRAKCIE przebiegu — evidence dostaje pewność
  // "po uwzględnieniu tego wyniku", spójną z kolejnością rozstrzygnięć.
  const out: PredictionRecord[] = [];
  for (const r of list) {
    if (r.evidence) { out.push(r); continue; } // zamknięta — nigdy nie otwiera się ponownie
    const facts = factsByEntity[r.entityId];
    const finish = (verdict: PredictionEvidence["verdict"], outcome: string, reason: string, ev: string[]): void => {
      const confidenceAfterResolution = calibratedConfidence(
        [...out, { ...r, evidence: { observedAt: now, outcome, evidence: ev, verdict, reason, confidenceAfterResolution: 0 } }],
        r.entityId,
        { learningEnabled: opts?.learningEnabled },
      );
      out.push({ ...r, evidence: { observedAt: now, outcome, evidence: ev, verdict, reason, confidenceAfterResolution } });
      changed = true;
    };
    if (!facts) {
      if (opts?.factsComplete) {
        finish("moot", "Podmiot prognozy nie istnieje już w CRM (usunięty).", "reguła: brak encji przy pełnym stanie danych → moot", [`brak leada ${r.entityId} w CRM`]);
      } else {
        out.push(r); // częściowa wiedza — nie zgaduj
      }
      continue;
    }
    // 1) Sprawa zamknięta (won/lost) przed rozstrzygnięciem → moot.
    if (facts.status && TERMINAL_STATUSES.includes(facts.status)) {
      finish("moot", `Sprawa zamknięta (status: ${facts.status}) przed terminem — pytanie o zaniedbanie nieaktualne.`, "reguła: status terminalny przed werdyktem → moot", [`status leada: ${facts.status}`]);
      continue;
    }
    // 2) Kontakt PO utworzeniu prognozy, a PRZED terminem → prevented (niezależnie od zegara —
    //    liczy się położenie kontaktu względem okna, nie „teraz").
    const contactedAfterWarning = facts.lastContactedAt != null && facts.lastContactedAt > r.madeAt;
    if (contactedAfterWarning && (facts.lastContactedAt as number) <= r.checkAt) {
      const spareDays = Math.round((r.checkAt - (facts.lastContactedAt as number)) / DAY);
      finish(
        "prevented",
        `Skontaktowano się przed terminem (${spareDays} dni zapasu) — zaniedbanie nie wystąpiło.`,
        "reguła: kontakt w oknie (madeAt, checkAt] → prevented (bez przypisywania sobie zasługi)",
        [`kontakt: ${new Date(facts.lastContactedAt as number).toISOString()}`, `termin: ${new Date(r.checkAt).toISOString()}`],
      );
      continue;
    }
    // 3) Termin jeszcze nie minął (także po cofnięciu zegara) → czekaj. Żadnego "correct" przed czasem.
    if (now < r.checkAt) { out.push(r); continue; }
    // 4) Termin minął bez kontaktu w oknie → correct (spóźniony kontakt to nadal przerwa).
    const note = contactedAfterWarning
      ? `Kontakt nastąpił dopiero PO terminie (spóźniony o ${Math.round(((facts.lastContactedAt as number) - r.checkAt) / DAY)} dni) — przerwa faktycznie wystąpiła.`
      : "Brak jakiegokolwiek kontaktu do terminu — przerwa faktycznie wystąpiła.";
    finish("correct", note, "reguła: now ≥ checkAt i brak kontaktu w oknie → correct", [
      facts.lastContactedAt != null ? `ostatni kontakt: ${new Date(facts.lastContactedAt).toISOString()}` : "brak zapisanego kontaktu",
      `termin: ${new Date(r.checkAt).toISOString()}`,
    ]);
  }
  return changed ? out : list;
}

/** Pure: oznacz DOWÓD rozstrzygnięcia jako błędny (kontrola użytkownika). Rekord i werdykt zostają
 *  w historii (audyt), ale wypadają z uczenia i statystyk celności. Nic innego nie jest zmieniane. */
export function disputeEvidence(records: PredictionRecord[], recordId: string, now: number): PredictionRecord[] {
  const list = records || [];
  const idx = list.findIndex((r) => r.id === recordId && r.evidence && r.evidence.disputedAt == null);
  if (idx < 0) return list;
  const r = list[idx];
  const next = [...list];
  next[idx] = { ...r, evidence: { ...(r.evidence as PredictionEvidence), disputedAt: now } };
  return next;
}

/** Pure: ograniczony rozmiar dziennika (S9) — pending nigdy nie wypada; rozstrzygnięte trzymamy
 *  najnowsze per encja (do MAX_RESOLVED_PER_ENTITY), potem twardy sufit globalny (najnowsze). */
export function compactLedger(records: PredictionRecord[]): PredictionRecord[] {
  const list = records || [];
  if (list.length <= MAX_TOTAL_RECORDS) {
    // Szybka ścieżka: sprawdź tylko limit per encja.
    const perEntity = new Map<string, number>();
    let over = false;
    for (const r of list) {
      if (!r.evidence) continue;
      const n = (perEntity.get(r.entityId) || 0) + 1;
      perEntity.set(r.entityId, n);
      if (n > MAX_RESOLVED_PER_ENTITY) { over = true; break; }
    }
    if (!over) return list;
  }
  const pending = list.filter((r) => !r.evidence);
  const resolvedByEntity = new Map<string, PredictionRecord[]>();
  for (const r of list) {
    if (!r.evidence) continue;
    const arr = resolvedByEntity.get(r.entityId) || [];
    arr.push(r);
    resolvedByEntity.set(r.entityId, arr);
  }
  let resolved: PredictionRecord[] = [];
  for (const arr of resolvedByEntity.values()) {
    arr.sort((a, b) => b.madeAt - a.madeAt);
    resolved = resolved.concat(arr.slice(0, MAX_RESOLVED_PER_ENTITY));
  }
  resolved.sort((a, b) => b.madeAt - a.madeAt);
  const budget = Math.max(0, MAX_TOTAL_RECORDS - pending.length);
  const kept = new Set([...pending, ...resolved.slice(0, budget)].map((r) => r.id));
  if (kept.size === list.length) return list; // nic nie wypadło → TA SAMA referencja (idempotencja)
  return list.filter((r) => kept.has(r.id)); // zachowaj oryginalną kolejność
}

// === Pełny cykl (czysty): rozstrzygnij → załóż nowe → przytnij. Adapter store'a: predictionCycle.ts ===

export interface CycleLeadInput {
  id: string;
  company: string;
  status: LeadStatus;
  lastContactedAt?: number;
  /** Czy follow-up dla tego leada jest REALNIE zaległy (liczy wołający — salesEngine zna kadencję). */
  overdue: boolean;
}

export interface PredictionCycleResult {
  ledger: PredictionRecord[];
  changed: boolean;
  created: PredictionRecord[];
  resolvedNow: PredictionRecord[];
}

/**
 * Pure: jeden idempotentny przebieg cyklu Dziennika Predykcji na PEŁNYM stanie danych.
 * Wielokrotne wywołanie z tymi samymi danymi = zero zmian (ta sama referencja tablicy).
 * Strefa czasowa/cofnięty zegar bez wpływu: wszystkie porównania na epoch-ms.
 */
export function runPredictionCycle(input: {
  ledger: PredictionRecord[];
  leads: CycleLeadInput[];
  /** Suma kwot „oczekuje płatności" per leadId (Finanse) — zmienia okno/przesłanki prognozy. */
  awaitingPaymentByLead: Record<string, number>;
  now: number;
  learningEnabled: boolean;
  makeId: () => string;
}): PredictionCycleResult {
  const facts: Record<string, EntityFacts> = {};
  for (const l of input.leads) facts[l.id] = { lastContactedAt: l.lastContactedAt, status: l.status };
  const before = input.ledger || [];
  const resolved = resolveDuePredictions(before, input.now, facts, { factsComplete: true, learningEnabled: input.learningEnabled });
  const resolvedNow = resolved === before ? [] : resolved.filter((r, i) => r !== before[i]);
  const created: PredictionRecord[] = [];
  let ledger = resolved;
  for (const l of input.leads) {
    if (!shouldRecordNeglectPrediction(ledger, l.id, l.overdue)) continue;
    const rec = recordNeglectPrediction(l.id, l.company, {
      id: input.makeId(),
      now: input.now,
      records: ledger,
      lastContactedAt: l.lastContactedAt,
      leadStatus: l.status,
      awaitingPaymentAmount: input.awaitingPaymentByLead[l.id] || 0,
      learningEnabled: input.learningEnabled,
    });
    ledger = [...ledger, rec];
    created.push(rec);
  }
  const compacted = compactLedger(ledger);
  const changed = resolvedNow.length > 0 || created.length > 0 || compacted !== ledger;
  return { ledger: changed ? compacted : before, changed, created, resolvedNow };
}

// === Podsumowania dla użytkownika (czat/UI) ===

export interface CalibrationSummary {
  total: number;
  pending: number;
  correct: number;
  prevented: number;
  moot: number;
  /** Rozstrzygnięcia oznaczone przez użytkownika jako błędny dowód (wyłączone z uczenia). */
  disputed: number;
}

/** Pure: uczciwe zliczenie werdyktów — globalnie albo per encja. Surowe liczby, bez jednego
 *  zmyślonego „% trafności" (zakwestionowane dowody liczone OSOBNO, nie w werdyktach). */
export function calibrationSummary(records: PredictionRecord[], entityId?: string): CalibrationSummary {
  const list = entityId ? (records || []).filter((r) => r.entityId === entityId) : (records || []);
  const active = list.filter((r) => !r.evidence || r.evidence.disputedAt == null);
  const disputed = list.length - active.length;
  return {
    total: list.length,
    pending: active.filter((r) => !r.evidence).length,
    correct: active.filter((r) => verdictOf(r) === "correct").length,
    prevented: active.filter((r) => verdictOf(r) === "prevented").length,
    moot: active.filter((r) => verdictOf(r) === "moot").length,
    disputed,
  };
}

/** Pure: jedno, ludzkie zdanie podsumowujące celność — nigdy nie zmyśla, gdy brak danych. */
export function calibrationText(summary: CalibrationSummary): string {
  if (summary.total === 0) return "Jeszcze żadnych zapisanych przewidywań — pojawią się, gdy wykryję zaniedbaną relację.";
  const parts: string[] = [];
  if (summary.correct > 0) parts.push(`${summary.correct} razy przerwa faktycznie się pogłębiła`);
  if (summary.prevented > 0) parts.push(`${summary.prevented} razy zdążyłeś zareagować przed terminem`);
  if (summary.moot > 0) parts.push(`${summary.moot} razy sprawa się zamknęła, zanim to się rozstrzygnęło`);
  if (summary.pending > 0) parts.push(`${summary.pending} nadal czeka na termin`);
  if (summary.disputed > 0) parts.push(`${summary.disputed} rozstrzygnięć oznaczyłeś jako błędne (nie liczą się do uczenia)`);
  return `Zapisanych przewidywań: ${summary.total}. ${parts.join("; ")}.`;
}

/** Pure: wyjaśnienie użytkownikowi, CZEGO system się nauczył (albo że jeszcze niczego / uczenie
 *  wyłączone) — obowiązek przejrzystości uczenia, nie marketing. */
export function explainLearning(records: PredictionRecord[], entityId: string, opts?: { learningEnabled?: boolean }): string {
  if (opts?.learningEnabled === false) return "Uczenie wyłączone — używam domyślnego okna 7 dni i pewności 70%. Historia zostaje, nic się z niej nie uczy.";
  const resolved = countableResolved(records, entityId).filter((r) => verdictOf(r) !== "moot");
  if (resolved.length < MIN_OBSERVATIONS) {
    return `Za mało rozstrzygnięć (${resolved.length}/${MIN_OBSERVATIONS}), żeby się czegoś nauczyć o tym kliencie — używam domyślnego okna 7 dni i pewności 70%.`;
  }
  const window = learnedWindowDays(records, entityId, opts);
  const conf = calibratedConfidence(records, entityId, opts);
  const prevented = resolved.filter((r) => verdictOf(r) === "prevented").length;
  return `Z ${resolved.length} rozstrzygnięć (${prevented}× zareagowałeś przed terminem): okno ostrzeżenia ${window} dni, pewność prognoz ${Math.round(conf * 100)}%. To prognozy, nie fakty — każdą rozstrzygam po terminie z realnych danych.`;
}
