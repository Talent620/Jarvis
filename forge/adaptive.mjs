/**
 * JARVIS FORGE — Adaptive Intelligence, Dynamic Team Composer & Competitive Multi-Model Judge.
 *
 * Realizuje 5 zasad Adaptive Intelligence:
 *  1. Proste zadania -> lokalny model bez kosztów API (`local_free`, Kat. A).
 *  2. Średnie zadania -> najlepszy dostępny darmowy model API (`api_free`, Kat. B; fallback `local_free`).
 *  3. Trudne zadania -> najmocniejszy dostępny wykonawca (potwierdzone darmowe limity Kat. B lub
 *     zatwierdzone kredyty promocyjne Kat. C pod twardym PromoBudgetGovernor, nigdy płatne bez zgody).
 *  4. Kod ZAWSZE przechodzi deterministyczną weryfikację testami + niezależną recenzję (cross-model).
 *  5. Gdy bieżący model nie daje rady -> zmiana strategii ORAZ eskalacja wykonawcy na wyższy poziom.
 *
 * Dodatkowo:
 *  - Dynamicznie dobiera MINIMALNY uzasadniony zespół agentów pod zadanie (jakość > liczba agentów).
 *  - Obiektywnie ocenia i porównuje równoległych kandydatów (jakość, czas, zużycie zasobów/kredytów).
 */
import { COST_CATEGORIES } from "./budget.mjs";

export const INTELLIGENCE_TIERS = {
  LOCAL_FREE: "local_free",
  API_FREE: "api_free",
  PROMO_CREDITS: "promo_credits",
};

const SIMPLE_SIGNALS = [
  /\b(fix\s+(?:a\s+|the\s+)?(?:small\s+)?bug|typo|off[- ]by[- ]one|one[- ]line|rename|format|discount|tax|rounding|simple|drobny\s+błąd|literówk|popraw\s+funkcj)\b/i,
];

const MULTI_FILE_SIGNALS = [
  /\b(across\s+\d+\s+files?|multiple\s+files?|multi[- ]file|wieloplik|kilku\s+plik|feature|refactor|endpoint|migration|recurring|store.*validator|validator.*store|export.*report|api\s+and\s+ui)\b/i,
];

const GREENFIELD_SIGNALS = [
  /\b(from\s+scratch|greenfield|od\s+zera|design\s+and\s+implement|zaprojektuj\s+i\s+zaimplementuj|build\s+a\s+new\s+module|stworz\s+(?:nowy\s+)?moduł|create\s+from\s+scratch)\b/i,
];

const HARD_ALGO_SIGNALS = [
  /\b(dag|topological|scheduler|concurren|parallel|async|abortsignal|cancellation|deadlock|race\s+condition|starvation|rate[- ]?limit|priority\s+queue|state\s+machine|compiler|parser|ast|crypto|sandbox|security\s+audit|distributed|consensus|cycle\s+detection|retry\s+with\s+backoff|worktree)\b/i,
];

const NEGATIVE_CLAUSE_RE = /(?:do\s+not|don't|never|nie)\s+(?:modify|edit|change|touch|zmieniaj|edytuj)(?:(?![,;\n]|\.(?:\s|$)).)*/gi;

/** Wyciągnij ze specyfikacji zadania ścieżki wyraźnie chronione ("Do not modify test/...", "nie zmieniaj ..."). */
export function extractProtectedPaths(goal = "") {
  const text = String(goal || "");
  const protectedSet = new Set();
  const negMatches = text.match(NEGATIVE_CLAUSE_RE) || [];
  for (const clause of negMatches) {
    const paths = clause.match(/(?:^|[\s(`'"])([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-z0-9]{1,6})\b/g) || [];
    for (const p of paths) {
      protectedSet.add(p.replace(/^[\s(`'"]+/, "").replace(/^\.\//, ""));
    }
  }
  return [...protectedSet];
}

/**
 * Deterministyczny klasyfikator trudności zadania (0 tokenów LLM, powtarzalny i audytowalny).
 * Analizuje cel, topologię repozytorium oraz historię wcześniejszych porażek z pamięci doświadczeń.
 */
export function assessTaskDifficulty({ goal = "", repoIndex = null, memory = null } = {}) {
  const text = String(goal || "").trim();
  const reasons = [];
  let score = 20;

  // 1. Wzmianki konkretnych plików w treści celu (z wykluczeniem klauzul negatywnych typu "Do not modify test/...")
  const positiveText = text.replace(NEGATIVE_CLAUSE_RE, " ");
  const mentionedFiles = [...new Set((positiveText.match(/(?:^|[\s(`'"])([a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-z0-9]{1,6})\b/g) || [])
    .map((m) => m.replace(/^[\s(`'"]+/, "")))];
  const fileCountInGoal = mentionedFiles.length;

  const isSimpleHint = SIMPLE_SIGNALS.some((re) => re.test(text));
  const isMultiFileHint = MULTI_FILE_SIGNALS.some((re) => re.test(text));
  const isGreenfield = GREENFIELD_SIGNALS.some((re) => re.test(text));
  const hardMatches = HARD_ALGO_SIGNALS.reduce((acc, re) => acc + (re.test(text) ? 1 : 0), 0);

  // Zlicz liczbę wymagań (np. numerowane punkty, średniki, wielokrotne "and/oraz")
  const numberedItems = (text.match(/(?:^|\n|\s)(?:\d+\)|\(\d+\)|-\s)/g) || []).length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (isSimpleHint && fileCountInGoal <= 1 && !isGreenfield && hardMatches === 0 && numberedItems <= 2) {
    score -= 8;
    reasons.push("Wyraźny sygnał małej, punktowej poprawki w 1 pliku.");
  }

  if (fileCountInGoal >= 4) {
    score += 24;
    reasons.push(`Cel wskazuje bezpośrednio ${fileCountInGoal} plików (${mentionedFiles.slice(0, 5).join(", ")}).`);
  } else if (fileCountInGoal >= 2) {
    score += 14;
    reasons.push(`Cel obejmuje ${fileCountInGoal} pliki (${mentionedFiles.join(", ")}).`);
  }

  if (isMultiFileHint) {
    score += fileCountInGoal >= 4 ? 6 : 16;
    reasons.push("Wykryto charakter zmian wieloplikowych / nowej funkcjonalności.");
  }

  if (isGreenfield) {
    score += 36;
    reasons.push("Zadanie typu greenfield (projekt + implementacja + testy od zera).");
  }

  if (hardMatches > 0) {
    // Policz pojedyncze unikalne terminy algorytmiczne/współbieżne
    const matchedTerms = [...new Set((text.match(/\b(dag|topological|scheduler|concurren\w*|parallel|async|abortsignal|cancellation|deadlock|race\s+condition|starvation|rate[- ]?limit\w*|priority\s+queue|state\s+machine|compiler|parser|ast|crypto|sandbox|security\s+audit|distributed|consensus|cycle\s+detection|retry|backoff|worktree)\b/gi) || []).map((s) => s.toLowerCase()))];
    const algoBonus = Math.min(36, 14 + matchedTerms.length * 6);
    score += algoBonus;
    reasons.push(`Złożoność algorytmiczna/współbieżna (${matchedTerms.slice(0, 5).join(", ")}).`);
  }

  if (numberedItems >= 4 || wordCount >= 75) {
    score += 14;
    reasons.push(`Rozbudowana specyfikacja (${wordCount} słów, ${numberedItems} punktów wymagań).`);
  } else if (numberedItems >= 2 || wordCount >= 40) {
    score += 6;
  }

  // 2. Kontekst repozytorium
  const totalFiles = Number(repoIndex?.stats?.totalFiles || repoIndex?.files?.length || 0);
  const hasExistingTests = Boolean(repoIndex?.profile?.testCommands?.length);
  if (totalFiles >= 300) {
    score += 12;
    reasons.push(`Duże repozytorium (${totalFiles} plików) — wyższe ryzyko regresji.`);
  } else if (totalFiles > 0 && totalFiles <= 6 && !isGreenfield && fileCountInGoal <= 1) {
    score -= 4;
  }
  if (!hasExistingTests && !isGreenfield) {
    score += 8;
    reasons.push("Brak gotowej komendy testowej — wymagana ostrożniejsza weryfikacja.");
  }

  // 3. Pamięć doświadczeń (czy podobne zadania wcześniej zawodziły?)
  let priorFailures = 0;
  if (memory && typeof memory.recallForContext === "function") {
    try {
      const recalled = memory.recallForContext({ goal: text, files: mentionedFiles });
      priorFailures = Array.isArray(recalled?.failedAttempts) ? recalled.failedAttempts.length : 0;
      if (priorFailures >= 2) {
        score += 14;
        reasons.push(`Pamięć repozytorium zawiera ${priorFailures} wcześniejsze nieudane próby w tym obszarze.`);
      }
    } catch { /* ignore */ }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level = "simple";
  let targetTier = INTELLIGENCE_TIERS.LOCAL_FREE;
  if (score >= 62) {
    level = "hard";
    targetTier = INTELLIGENCE_TIERS.PROMO_CREDITS;
  } else if (score >= 30) {
    level = "medium";
    targetTier = INTELLIGENCE_TIERS.API_FREE;
  }

  if (!reasons.length) {
    reasons.push(level === "simple" ? "Niska złożoność zadania — wystarczy lokalny model bez kosztów API." : "Umiarkowana złożoność zadania.");
  }

  return {
    level,
    score,
    targetTier,
    reasons,
    signals: {
      mentionedFiles,
      fileCountInGoal,
      wordCount,
      numberedItems,
      isSimpleHint,
      isMultiFileHint,
      isGreenfield,
      hardAlgorithmic: hardMatches > 0,
      repoTotalFiles: totalFiles,
      hasExistingTests,
      priorFailures,
    },
  };
}

/**
 * Zbuduj uporządkowaną drabinę eskalacji tierów inteligencji zgodnie z polityką kosztów.
 * Gwarantuje: brak przejścia na `promo_credits` bez jawnego budżetu i brak przejścia na `paid`.
 */
export function buildEscalationLadder({
  startTier = INTELLIGENCE_TIERS.LOCAL_FREE,
  costPolicy = "zero_cost",
  hasLocal = false,
  hasApiFree = false,
  hasPromo = false,
} = {}) {
  const allowed = [];
  if (hasLocal) allowed.push(INTELLIGENCE_TIERS.LOCAL_FREE);
  if (costPolicy !== "local_only" && hasApiFree) allowed.push(INTELLIGENCE_TIERS.API_FREE);
  if ((costPolicy === "allow_promo_credits" || costPolicy === "allow_credits") && hasPromo) {
    allowed.push(INTELLIGENCE_TIERS.PROMO_CREDITS);
  }
  if (!allowed.length) {
    // Nawet gdy matrix jeszcze nie ma danych, zachowaj minimalną logiczną drabinę zgodną z polityką
    if (costPolicy === "local_only") return [INTELLIGENCE_TIERS.LOCAL_FREE];
    if (costPolicy === "allow_promo_credits" || costPolicy === "allow_credits") {
      return [INTELLIGENCE_TIERS.LOCAL_FREE, INTELLIGENCE_TIERS.API_FREE, INTELLIGENCE_TIERS.PROMO_CREDITS];
    }
    return [INTELLIGENCE_TIERS.LOCAL_FREE, INTELLIGENCE_TIERS.API_FREE];
  }

  const order = [INTELLIGENCE_TIERS.LOCAL_FREE, INTELLIGENCE_TIERS.API_FREE, INTELLIGENCE_TIERS.PROMO_CREDITS];
  const startIdx = Math.max(0, order.indexOf(startTier));
  // Wybierz tier startowy lub najbliższy dostępny (dla hard: najmocniejszy dostępny; dla simple/medium: nie skacz od razu na promo!)
  if (startTier === INTELLIGENCE_TIERS.PROMO_CREDITS) {
    return [...allowed].reverse(); // zacznij od najmocniejszego dostępnego (promo -> api_free -> local_free)
  }
  const atOrAbove = allowed.filter((t) => order.indexOf(t) >= startIdx);
  const below = allowed.filter((t) => order.indexOf(t) < startIdx).reverse();
  if (startTier === INTELLIGENCE_TIERS.API_FREE && !hasApiFree) {
    // Dla średniego zadania bez Kat. B zacznij od local_free, a dopiero na eskalacji użyj promo_credits (jeśli zatwierdzone)!
    return [...below, ...atOrAbove];
  }
  return [...atOrAbove, ...below];
}

/**
 * Przełóż aktywny poziom inteligencji (`local_free` | `api_free` | `promo_credits`)
 * na preferowane i dozwolone kategorie dla `providerPool.selectCandidatesForRole`.
 */
export function tierToProviderPreferences(tier, { allowFallbackToLower = true } = {}) {
  if (tier === INTELLIGENCE_TIERS.LOCAL_FREE) {
    return {
      preferredCategories: [COST_CATEGORIES.LOCAL_FREE],
      allowedCategories: [COST_CATEGORIES.LOCAL_FREE],
      label: "Tier 1 — Local Free (0 USD, offline)",
    };
  }
  if (tier === INTELLIGENCE_TIERS.API_FREE) {
    return {
      preferredCategories: allowFallbackToLower
        ? [COST_CATEGORIES.API_FREE, COST_CATEGORIES.LOCAL_FREE]
        : [COST_CATEGORIES.API_FREE],
      allowedCategories: allowFallbackToLower
        ? [COST_CATEGORIES.API_FREE, COST_CATEGORIES.LOCAL_FREE]
        : [COST_CATEGORIES.API_FREE],
      label: "Tier 2 — API Free (0 USD, darmowe limity API)",
    };
  }
  return {
    preferredCategories: allowFallbackToLower
      ? [COST_CATEGORIES.PROMO_CREDITS, COST_CATEGORIES.API_FREE, COST_CATEGORIES.LOCAL_FREE]
      : [COST_CATEGORIES.PROMO_CREDITS],
    allowedCategories: allowFallbackToLower
      ? [COST_CATEGORIES.PROMO_CREDITS, COST_CATEGORIES.API_FREE, COST_CATEGORIES.LOCAL_FREE]
      : [COST_CATEGORIES.PROMO_CREDITS],
    label: "Tier 3 — Strongest Verified (zatwierdzone kredyty promocyjne z twardym limitem)",
  };
}

/**
 * Dynamiczny konstruktor zespołów agentów (Task-Driven Team Composer).
 * Zasada przewodnia: PRIORYTETEM JEST JAKOŚĆ WYKONANIA, A NIE LICZBA AGENTÓW!
 * Nie tworzy rozdmuchanych zespołów dla prostych zadań ani bezmyślnej równoległości na słabym CPU.
 */
export function composeAgentTeam({
  difficulty,
  repoIndex = null,
  providerMatrix = [],
  hardware = null,
  costPolicy = "zero_cost",
  allowCompetitive = false,
  hasPromoBudget = false,
  isWorktreeReady = false,
} = {}) {
  const diff = difficulty || assessTaskDifficulty({ goal: "", repoIndex });
  const ready = (providerMatrix || []).filter((p) => p.status === "ready" && p.allowedInPolicy !== false);
  const readyLocal = ready.filter((p) => p.costCategory === COST_CATEGORIES.LOCAL_FREE);
  const readyApiFree = ready.filter((p) => p.costCategory === COST_CATEGORIES.API_FREE);
  const readyPromo = ready.filter((p) => p.costCategory === COST_CATEGORIES.PROMO_CREDITS);

  const hasLocal = readyLocal.length > 0;
  const hasApiFree = readyApiFree.length > 0;
  const hasPromo = readyPromo.length > 0 && hasPromoBudget && (costPolicy === "allow_promo_credits" || costPolicy === "allow_credits");

  const escalationLadder = buildEscalationLadder({
    startTier: diff.targetTier,
    costPolicy,
    hasLocal,
    hasApiFree,
    hasPromo,
  });
  const initialTier = escalationLadder[0] || INTELLIGENCE_TIERS.LOCAL_FREE;

  // Policz liczbę wyraźnie różnych modeli (do cross-model review i ewentualnego trybu konkurencyjnego)
  const distinctLocalModels = (readyLocal.find((p) => p.id === "ollama")?.installedModels || []).length;
  const distinctSolverCount = readyApiFree.length + readyPromo.length + Math.max(readyLocal.length, Math.min(2, distinctLocalModels));

  if (diff.level === "simple") {
    const canSkipArchitect = Boolean(diff.signals?.hasExistingTests && diff.signals?.repoTotalFiles > 0 && !diff.signals?.isGreenfield);
    return {
      teamPattern: "lean_2_agent",
      agentCount: canSkipArchitect ? 2 : 3,
      roles: canSkipArchitect
        ? [
            { role: "developer", tier: initialTier, reason: "Bezpośrednia poprawka w 1 pliku bez narzutu planowania." },
            { role: "verifier", tier: "deterministic_0_token", reason: "Realne testy projektu (0 tokenów)." },
            { role: "reviewer", tier: hasLocal ? INTELLIGENCE_TIERS.LOCAL_FREE : initialTier, reason: "Niezależna recenzja diffu (inny model, jeśli dostępny)." },
          ]
        : [
            { role: "architect", tier: initialTier, reason: "Krótki plan (brak gotowych testów wykrytych z góry)." },
            { role: "developer", tier: initialTier, reason: "Implementacja poprawki." },
            { role: "verifier", tier: "deterministic_0_token", reason: "Weryfikacja składni i testów (0 tokenów)." },
            { role: "reviewer", tier: hasLocal ? INTELLIGENCE_TIERS.LOCAL_FREE : initialTier, reason: "Niezależna recenzja diffu." },
          ],
      omittedRoles: canSkipArchitect
        ? ["architect (pominięty — zadanie punktowe w repo z testami)", "parallel_competitors (zbędny narzut dla prostego zadania)"]
        : ["parallel_competitors (zbędny narzut dla prostego zadania)"],
      skipArchitect: canSkipArchitect,
      useCompetitive: false,
      competitiveReason: "Proste zadanie — uruchomienie wielu równoległych modeli podwoiłoby czas/zasoby bez realnego zysku jakości.",
      initialTier,
      escalationLadder,
      rationale: `Zadanie proste (wynik ${diff.score}/100): dobrano lekki zespół ${canSkipArchitect ? "2-agentowy" : "3-agentowy"} na poziomie ${initialTier} z niezależnym recenzentem i automatyczną eskalacją dopiero w razie porażki testów.`,
    };
  }

  if (diff.level === "medium") {
    return {
      teamPattern: "disciplined_4_role",
      agentCount: 4,
      roles: [
        { role: "architect", tier: initialTier, reason: "Dekompozycja wieloplikowa i wyznaczenie targetFiles dla bramki kompletności." },
        { role: "developer", tier: initialTier, reason: "Wieloetapowa implementacja w pętli ACI z Edit-Lint-Revert." },
        { role: "verifier", tier: "deterministic_0_token", reason: "Deterministyczne testy, analiza wpływu 2-hop i Completeness Gate." },
        { role: "debugger", tier: escalationLadder[1] || initialTier, reason: "Aktywowany wyłącznie po niepowodzeniu testów — ze zmianą strategii i eskalacją." },
        { role: "reviewer", tier: hasLocal && initialTier !== INTELLIGENCE_TIERS.LOCAL_FREE ? INTELLIGENCE_TIERS.LOCAL_FREE : initialTier, reason: "Niezależna weryfikacja kompletności (preferowany cross-model)." },
      ],
      omittedRoles: ["parallel_competitors (nieuzasadnione kosztem dla średnich zadań — najpierw zdyscyplinowana pętla z eskalacją)"],
      skipArchitect: false,
      useCompetitive: false,
      competitiveReason: "Średnie zadanie — zdyscyplinowana pętla z bramką kompletności i eskalacją daje lepszy stosunek jakości do zasobów niż ślepy równoległy turniej.",
      initialTier,
      escalationLadder,
      rationale: `Zadanie średnie (wynik ${diff.score}/100): zespół 4-rolny (Architect → Developer → Verifier → Cross-Model Reviewer + Debugger na żądanie), start od ${initialTier}, drabina eskalacji: ${escalationLadder.join(" → ")}.`,
    };
  }

  // HARD TASK: sprawdź czy tryb konkurencyjny (2 izolowane worktree) jest realnie uzasadniony
  const cpuLightDualLocalOnly = hardware?.tier === "cpu_light" && !hasApiFree && !hasPromo;
  const competitiveJustified = Boolean(
    allowCompetitive
    && isWorktreeReady
    && distinctSolverCount >= 2
    && !cpuLightDualLocalOnly,
  );

  let competitiveReason = "Wyłączony (nie zażądano trybu konkurencyjnego).";
  if (allowCompetitive) {
    if (!isWorktreeReady) competitiveReason = "Repo nie obsługuje git worktree (brak commitu HEAD) — bezpieczny fallback do pojedynczego zespołu.";
    else if (distinctSolverCount < 2) competitiveReason = "Dostępny tylko 1 odrębny wykonawca — tryb konkurencyjny wymaga >=2 niezależnych modeli lub strategii.";
    else if (cpuLightDualLocalOnly) competitiveReason = "Wykryto profil cpu_light bez zdalnego modelu — równoległe odpalenie 2 modeli Ollama jednocześnie zdławiłoby RAM/CPU; jeśli wymuszone, wykonuj sekwencyjnie.";
    else competitiveReason = `Uzasadnione dla trudnego zadania (${diff.score}/100): dostępnych ${distinctSolverCount} odrębnych wykonawców + izolowane git worktree + obiektywny sędzia deterministyczny.`;
  }

  return {
    teamPattern: competitiveJustified ? "competitive_dual_worktree" : "specialist_squad",
    agentCount: competitiveJustified ? 5 : 4,
    roles: [
      { role: "architect", tier: initialTier, reason: "Architektura modułu, podział na pliki i specyfikacja testów." },
      { role: "developer", tier: initialTier, reason: competitiveJustified ? "2 niezależnych kandydatów w izolowanych git worktree." : "Najmocniejszy dozwolony wykonawca." },
      { role: "verifier", tier: "deterministic_0_token", reason: "Twardy sędzia testowy (0 tokenów) odrzucający każdy kod bez exit 0." },
      { role: "debugger", tier: initialTier, reason: "Głęboka analiza porażek testów z pamięcią prób i zmianą strategii." },
      { role: "reviewer", tier: hasLocal && initialTier !== INTELLIGENCE_TIERS.LOCAL_FREE ? INTELLIGENCE_TIERS.LOCAL_FREE : initialTier, reason: "Niezależny recenzent końcowy (cross-model)." },
    ],
    omittedRoles: competitiveJustified
      ? ["3+ równoległych kandydatów (limit 2 kandydatów chroni budżet kredytów i czas)"]
      : ["parallel_competitors (oszczędność zasobów — pojedynczy mocny zespół z eskalacją)"],
    skipArchitect: false,
    useCompetitive: competitiveJustified,
    competitiveReason,
    initialTier,
    escalationLadder,
    rationale: `Zadanie trudne (wynik ${diff.score}/100): ${competitiveJustified ? "zespół konkurencyjny (2 izolowane worktree + sędzia deterministyczny)" : "zespół specjalistyczny (Architect/Developer/Debugger/Verifier/Cross-Model Reviewer)"}, start od ${initialTier}, drabina: ${escalationLadder.join(" → ")}.`,
  };
}

/**
 * Obiektywna, deterministyczna ocena kandydata w trybie konkurencyjnym (0–100 pkt).
 * TWARDA BRAMKA: kandydat, który nie przeszedł realnych testów lub skanu sekretów,
 * ma `eligible: false` i NIGDY nie może zostać wybrany zwycięzcą!
 */
export function scoreCandidateSolution({
  candidateId,
  label,
  runState,
  independentVerify = null,
  diffLines = 0,
  durationMs = 0,
  costCategory = COST_CATEGORIES.LOCAL_FREE,
  estimatedPromoUsd = 0,
  tokensIn = 0,
  tokensOut = 0,
} = {}) {
  const modifiedCount = Array.isArray(runState?.modifiedFiles) ? runState.modifiedFiles.length : 0;
  const secretClean = runState?.review ? runState.review.secretScanClean !== false : true;
  const zeroTestsRan = independentVerify && independentVerify.passCount === 0 && (independentVerify.failCount === 0 || independentVerify.failCount === null);
  const testsPassed = independentVerify
    ? Boolean(independentVerify.ok && !zeroTestsRan)
    : runState?.status === "completed";
  const completed = runState?.status === "completed";
  const reviewApproved = Boolean(runState?.review?.approved);
  const syntaxClean = (runState?.modifiedFiles || []).every((m) => m.syntaxOk !== false);
  const securityEventsCount = Array.isArray(runState?.securityEvents) ? runState.securityEvents.length : 0;

  // Zlicz procent pokrycia planowanych targetFiles (jeśli Architect je wyznaczył)
  const targetFiles = Array.isArray(runState?.targetFiles) ? runState.targetFiles : [];
  const modifiedPaths = new Set((runState?.modifiedFiles || []).map((m) => m.path));
  const targetCoverage = targetFiles.length
    ? targetFiles.filter((f) => modifiedPaths.has(f)).length / targetFiles.length
    : (modifiedCount > 0 ? 1 : 0);

  const eligible = Boolean(completed && testsPassed && secretClean && syntaxClean && modifiedCount > 0);

  const breakdown = {
    testsScore: testsPassed ? 50 : 0,
    reviewScore: reviewApproved ? 20 : 0,
    completenessScore: Math.round(targetCoverage * 10),
    safetyScore: (secretClean && syntaxClean && securityEventsCount === 0) ? 5 : 0,
    concisenessScore: modifiedCount > 0 ? Math.max(1, 5 - Math.floor(Math.max(0, diffLines - 250) / 150)) : 0,
    resourceEfficiencyScore: costCategory === COST_CATEGORIES.LOCAL_FREE ? 5
      : costCategory === COST_CATEGORIES.API_FREE ? 3
        : 1,
    speedScore: durationMs > 0 ? Math.max(0, Math.min(5, Math.round(5 - (durationMs / 60_000)))) : 3,
  };

  let totalScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  if (!eligible) totalScore = Math.min(35, totalScore);

  const diffFingerprintByFile = Object.fromEntries(
    (runState?.modifiedFiles || []).map((m) => [m.path, String(m.diff || `${m.action}:${m.bytes || 0}`)]),
  );

  return {
    candidateId,
    label,
    eligible,
    score: totalScore,
    breakdown,
    status: runState?.status || "failed",
    testsPassed,
    testsPassCount: independentVerify?.passCount ?? null,
    testsFailCount: independentVerify?.failCount ?? null,
    reviewApproved,
    reviewer: runState?.review?.reviewer || null,
    providersUsed: runState?.providersUsed || [],
    modifiedFiles: (runState?.modifiedFiles || []).map((m) => m.path),
    diffFingerprintByFile,
    diffLines,
    iterations: runState?.iterations ?? runState?.iteration ?? 0,
    repairCycles: runState?.repairCycle ?? 0,
    durationMs,
    costCategory,
    outOfPocketUsd: 0,
    estimatedPromoUsd: Number((estimatedPromoUsd || 0).toFixed(5)),
    tokensIn,
    tokensOut,
    failureReason: eligible ? null : (runState?.finalResult || independentVerify?.error || "Nie przeszedł bramki weryfikacji testowej"),
  };
}

/**
 * Porównaj wszystkich kandydatów z turnieju i sformułuj uczciwy werdykt (jakość vs czas vs zasoby).
 */
export function compareCompetitiveCandidates(scoredList = [], { executionMode = "true_parallel", totalWallClockMs = 0 } = {}) {
  const sorted = [...scoredList].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    if (a.estimatedPromoUsd !== b.estimatedPromoUsd) return a.estimatedPromoUsd - b.estimatedPromoUsd;
    return a.durationMs - b.durationMs;
  });

  const eligibleOnes = sorted.filter((c) => c.eligible);
  const winner = eligibleOnes[0] || null;
  const runnerUp = sorted[1] || null;

  const totalPromoUsd = Number(sorted.reduce((sum, c) => sum + (c.estimatedPromoUsd || 0), 0).toFixed(5));
  const sumDurationMs = sorted.reduce((sum, c) => sum + (c.durationMs || 0), 0);

  // Wykryj sprzeczne rozwiązania między kandydatami (różne zmiany w tych samych plikach lub rozbieżny zestaw plików)
  let conflictingSolutionsDetected = false;
  const divergentFiles = [];
  if (sorted.length >= 2) {
    const fileSets = sorted.map((c) => new Set(c.modifiedFiles || []));
    const allFiles = new Set(sorted.flatMap((c) => c.modifiedFiles || []));
    for (const f of allFiles) {
      const presentCount = fileSets.filter((s) => s.has(f)).length;
      const hashes = new Set(
        sorted
          .filter((c) => (c.modifiedFiles || []).includes(f))
          .map((c) => c.diffFingerprintByFile?.[f] || `${c.candidateId}:${c.diffLines}:${c.score}`),
      );
      if (presentCount < sorted.length || hashes.size > 1) {
        divergentFiles.push(f);
      }
    }
    conflictingSolutionsDetected = divergentFiles.length > 0;
  }

  let parallelWorthIt = false;
  let verdictReason = "";
  let conflictResolution = null;
  if (!winner) {
    parallelWorthIt = false;
    verdictReason = `Żaden z ${sorted.length} kandydatów nie przeszedł twardej weryfikacji testowej — nic nie scalono.`;
    if (conflictingSolutionsDetected) {
      conflictResolution = `Wykryto rozbieżne zmiany w ${divergentFiles.join(", ")}, lecz żaden kandydat nie zaliczył testów — repo bazowe pozostało nietknięte.`;
    }
  } else if (eligibleOnes.length === 1 && sorted.length >= 2) {
    parallelWorthIt = true;
    verdictReason = `Tylko 1 z ${sorted.length} kandydatów (${winner.label}, ${winner.score}/100) zaliczył wszystkie testy — tryb konkurencyjny uratował wynik tam, gdzie drugi model/strategia zawiódł.`;
    if (conflictingSolutionsDetected) {
      conflictResolution = `Sprzeczne rozwiązania rozstrzygnięto deterministycznie: tylko ${winner.label} przeszedł testy; odrzucono niezweryfikowany wariant (${runnerUp?.label || "kandydat 2"}) bez mieszania patchy.`;
    }
  } else if (eligibleOnes.length >= 2 && runnerUp) {
    const scoreGap = winner.score - runnerUp.score;
    const savedPromo = (runnerUp.estimatedPromoUsd || 0) - (winner.estimatedPromoUsd || 0);
    parallelWorthIt = scoreGap >= 6 || savedPromo > 0.02;
    verdictReason = parallelWorthIt
      ? `Obaj kandydaci przeszli testy; zwycięzca ${winner.label} (${winner.score}/100) wyraźnie wyprzedził ${runnerUp.label} (${runnerUp.score}/100) jakością lub kosztem zasobów.`
      : `Obaj kandydaci przeszli testy o zbliżonej jakości (${winner.score} vs ${runnerUp.score}) — dla tej klasy zadań pojedynczy model z eskalacją jest bardziej ekonomiczny.`;
    if (conflictingSolutionsDetected) {
      conflictResolution = `Oba modele zaliczyły testy ze sprzecznymi zmianami w [${divergentFiles.join(", ")}]. Wdrożono wyłącznie zwycięski wariant ${winner.label} (${winner.score}/100 vs ${runnerUp.score}/100) bez łączenia sprzecznych diffów; odrzucony wariant zachowano w raporcie.`;
    }
  } else {
    verdictReason = `Zwycięzca: ${winner.label} (${winner.score}/100).`;
  }

  return {
    executionMode,
    totalWallClockMs,
    sumCandidateDurationMs: sumDurationMs,
    parallelSpeedupFactor: totalWallClockMs > 0 ? Number((sumDurationMs / totalWallClockMs).toFixed(2)) : 1,
    outOfPocketUsd: 0,
    totalEstimatedPromoUsd: totalPromoUsd,
    winnerId: winner?.candidateId || null,
    winnerLabel: winner?.label || null,
    winnerScore: winner?.score ?? null,
    eligibleCount: eligibleOnes.length,
    totalCandidates: sorted.length,
    parallelWorthIt,
    conflictingSolutionsDetected,
    divergentFiles,
    conflictResolution,
    verdictReason,
    ranking: sorted,
  };
}
