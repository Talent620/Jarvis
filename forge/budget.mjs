/**
 * JARVIS FORGE — 3-Category Cost Architecture & Promotional Credits Governor.
 *
 * Ścisły podział kategorii kosztów:
 *   A. `local_free`     — lokalne modele i własny sprzęt (0 USD, offline).
 *   B. `api_free`       — rzeczywiście darmowe limity API dostawców (0 USD, RPM/RPD/TPM).
 *   C. `promo_credits`  — potwierdzone kredyty promocyjne (np. Modal) z twardym budżetem,
 *                         limitem pojedynczego eksperymentu, limitem całkowitym, limitem czasu,
 *                         automatycznym zatrzymaniem i TWARDYM ZAKAZEM przejścia na płatne rozliczenie.
 *   (Kategoria `paid` pozostaje całkowicie odseparowana i zablokowana bez jawnego `allow_paid`.)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { atomicWriteFile } from "./security.mjs";

export const COST_CATEGORIES = {
  LOCAL_FREE: "local_free",
  API_FREE: "api_free",
  PROMO_CREDITS: "promo_credits",
  PAID: "paid",
};

/** Mapowanie z klasy dostawcy (`local | free_api | promo_credit | paid`) na 3+1 kategorie kosztowe. */
export function costCategoryOf(costTier) {
  if (costTier === "local") return COST_CATEGORIES.LOCAL_FREE;
  if (costTier === "free_api") return COST_CATEGORIES.API_FREE;
  if (costTier === "promo_credit") return COST_CATEGORIES.PROMO_CREDITS;
  return COST_CATEGORIES.PAID;
}

/** Stawki GPU Modal zweryfikowane przez `modal billing rates` (USD/h). */
export const MODAL_GPU_RATES_USD_PER_HOUR = {
  T4: 0.59,
  L4: 0.80,
  A10G: 1.10,
  L40S: 1.95,
  "A100-40GB": 2.10,
  "A100-80GB": 2.50,
};

const DEFAULT_LEDGER_VERSION = 1;

/** Parsuj wynik `modal billing summary` bez zgadywania salda. */
export function parseModalBillingSummary(rawOutput) {
  const txt = String(rawOutput || "");
  const extract = (label) => {
    const re = new RegExp(`${label}:\\s*\\$?(-?[0-9]+(?:\\.[0-9]+)?)`, "i");
    const m = txt.match(re);
    return m ? Number(m[1]) : null;
  };
  const meteredCost = extract("Metered Cost");
  const deployedApps = extract("Deployed Apps");
  const credits = extract("Credits");
  const billedCost = extract("Billed Cost");
  return {
    parsed: billedCost !== null || meteredCost !== null,
    meteredCostUsd: meteredCost,
    deployedAppsUsd: deployedApps,
    creditsAppliedUsd: credits !== null ? Math.abs(credits) : null,
    billedCostUsd: billedCost,
    hasPaidBilling: billedCost !== null && billedCost > 0,
  };
}

/**
 * Zweryfikuj faktyczne saldo i warunki Modal CLI (read-only, 0 USD).
 * NIGDY nie zakłada, że kredyty są dostępne — zwraca `verified: true` wyłącznie po rzeczywistym
 * potwierdzeniu `Billed Cost: $0.00` i aktywnego profilu Modal.
 */
export function verifyModalPromoStatus({ timeoutMs = 10_000 } = {}) {
  try {
    const profile = execFileSync("modal", ["profile", "current"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    }).trim();
    const rawSummary = execFileSync("modal", ["billing", "summary"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    const billing = parseModalBillingSummary(rawSummary);
    if (!billing.parsed) {
      return {
        verified: false,
        available: false,
        profile,
        reason: "Nie udało się sparsować raportu `modal billing summary` — odmawiam uruchomienia zasobów.",
        billing,
      };
    }
    if (billing.hasPaidBilling) {
      return {
        verified: true,
        available: false,
        profile,
        reason: `WYKRYTO PŁATNE ROZLICZENIE Modal (Billed Cost: $${billing.billedCostUsd.toFixed(2)} > $0.00) — twarda blokada kredytów promocyjnych!`,
        billing,
      };
    }
    return {
      verified: true,
      available: true,
      profile,
      reason: `Potwierdzony profil Modal (${profile}): Billed Cost = $0.00, dotychczas wykorzystane kredyty = $${(billing.creditsAppliedUsd ?? 0).toFixed(2)}.`,
      billing,
    };
  } catch (e) {
    return {
      verified: false,
      available: false,
      profile: null,
      reason: `Brak zweryfikowanego dostępu do Modal CLI: ${e instanceof Error ? e.message : String(e)}`,
      billing: null,
    };
  }
}

/**
 * Walidacja jawnej koperty budżetowej dla kategorii C (Promotional Credits).
 * Zasada twarda: BRAK uruchamiania zasobów bez określonego budżetu eksperymentu,
 * budżetu całkowitego oraz limitu czasu!
 */
export function validatePromoBudgetSpec(spec) {
  if (!spec || typeof spec !== "object") {
    return {
      ok: false,
      reason: "Kredyty promocyjne wymagają jawnej koperty budżetowej { maxExperimentUsd, maxTotalUsd, maxDurationSeconds }.",
    };
  }
  const maxExperimentUsd = Number(spec.maxExperimentUsd);
  const maxTotalUsd = Number(spec.maxTotalUsd);
  const maxDurationSeconds = Number(spec.maxDurationSeconds);
  const gpuSpec = String(spec.gpuSpec || "L4");
  const gpuRateUsdPerHour = Number(spec.gpuRateUsdPerHour || MODAL_GPU_RATES_USD_PER_HOUR[gpuSpec] || 0.80);

  if (!Number.isFinite(maxExperimentUsd) || maxExperimentUsd <= 0 || maxExperimentUsd > 5) {
    return { ok: false, reason: "Nieprawidłowy limit pojedynczego eksperymentu (wymagane 0 < maxExperimentUsd <= 5.00 USD)." };
  }
  if (!Number.isFinite(maxTotalUsd) || maxTotalUsd <= 0 || maxTotalUsd > 25) {
    return { ok: false, reason: "Nieprawidłowy limit całkowity kredytów (wymagane 0 < maxTotalUsd <= 25.00 USD)." };
  }
  if (maxExperimentUsd > maxTotalUsd) {
    return { ok: false, reason: "Limit pojedynczego eksperymentu nie może przekraczać limitu całkowitego." };
  }
  if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds < 10 || maxDurationSeconds > 900) {
    return { ok: false, reason: "Nieprawidłowy limit czasu eksperymentu (wymagane 10 <= maxDurationSeconds <= 900 s)." };
  }
  if (spec.allowPaidOverflow === true) {
    return { ok: false, reason: "Przejście z kredytów promocyjnych na rozliczenie płatne (allowPaidOverflow) jest TWARDO ZABRONIONE." };
  }

  return {
    ok: true,
    normalized: {
      experimentId: String(spec.experimentId || `exp-${Date.now()}`),
      maxExperimentUsd: Number(maxExperimentUsd.toFixed(4)),
      maxTotalUsd: Number(maxTotalUsd.toFixed(4)),
      maxDurationSeconds: Math.round(maxDurationSeconds),
      gpuSpec,
      gpuRateUsdPerHour,
      allowPaidOverflow: false,
      requireBillingZeroCheck: spec.requireBillingZeroCheck !== false,
    },
  };
}

/**
 * Twardy kontroler budżetu kredytów promocyjnych (Promotional Credits Governor).
 * Utrwala stan wydatków w `<storageDir>/promo-budget.json`, kontroluje czas, koszt
 * eksperymentu i koszt całkowity oraz automatycznie zatrzymuje dalsze wywołania po limicie.
 */
export function createPromoBudgetGovernor({ storageDir, budgetSpec, billingVerifier = verifyModalPromoStatus } = {}) {
  const validation = validatePromoBudgetSpec(budgetSpec);
  if (!validation.ok) {
    const err = new Error(validation.reason);
    err.code = "PROMO_BUDGET_INVALID";
    throw err;
  }
  const spec = validation.normalized;
  const ledgerPath = storageDir ? path.join(path.resolve(storageDir), "promo-budget.json") : null;
  const startedAtMs = Date.now();
  let experimentSpentUsd = 0;
  let callsCount = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let stopped = false;
  let stopReason = null;
  let billingCheckResult = null;

  const loadLedger = () => {
    if (!ledgerPath) return { version: DEFAULT_LEDGER_VERSION, totalSpentUsd: 0, experiments: {} };
    try {
      const parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
      if (parsed && typeof parsed.totalSpentUsd === "number") return parsed;
    } catch { /* fresh ledger */ }
    return { version: DEFAULT_LEDGER_VERSION, totalSpentUsd: 0, experiments: {} };
  };

  const ledger = loadLedger();
  if (ledger.experiments[spec.experimentId]) {
    experimentSpentUsd = Number(ledger.experiments[spec.experimentId].spentUsd || 0);
    callsCount = Number(ledger.experiments[spec.experimentId].calls || 0);
  }

  const saveLedger = () => {
    if (!ledgerPath) return;
    ledger.updatedAt = new Date().toISOString();
    ledger.experiments[spec.experimentId] = {
      spentUsd: Number(experimentSpentUsd.toFixed(6)),
      calls: callsCount,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
      maxExperimentUsd: spec.maxExperimentUsd,
      maxDurationSeconds: spec.maxDurationSeconds,
      stopped,
      stopReason,
      updatedAt: ledger.updatedAt,
    };
    atomicWriteFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n");
  };

  function getElapsedSeconds() {
    return (Date.now() - startedAtMs) / 1000;
  }

  /** Sprawdź przed wywołaniem dostawcy kategorii C czy mieścimy się w budżecie, czasie i zasadzie 0 USD billed. */
  function assertCanSpend(estimatedCallSeconds = 15) {
    if (stopped) {
      const err = new Error(`Budżet kredytów promocyjnych zatrzymany: ${stopReason}`);
      err.code = "PROMO_BUDGET_STOPPED";
      throw err;
    }

    if (spec.requireBillingZeroCheck && !billingCheckResult) {
      billingCheckResult = billingVerifier();
      if (!billingCheckResult.verified || !billingCheckResult.available || billingCheckResult.billing?.hasPaidBilling) {
        stopped = true;
        stopReason = billingCheckResult.reason || "Niepotwierdzone saldo kredytów promocyjnych.";
        saveLedger();
        const err = new Error(stopReason);
        err.code = "PROMO_CREDITS_UNVERIFIED";
        throw err;
      }
    }

    const elapsedSec = getElapsedSeconds();
    if (elapsedSec >= spec.maxDurationSeconds) {
      stopped = true;
      stopReason = `Przekroczono twardy limit czasu eksperymentu (${Math.round(elapsedSec)}s >= ${spec.maxDurationSeconds}s) — automatyczne zatrzymanie.`;
      saveLedger();
      const err = new Error(stopReason);
      err.code = "PROMO_TIME_LIMIT_EXCEEDED";
      throw err;
    }

    const projectedUsd = (Math.max(1, estimatedCallSeconds) / 3600) * spec.gpuRateUsdPerHour;
    if (experimentSpentUsd + projectedUsd > spec.maxExperimentUsd) {
      stopped = true;
      stopReason = `Osiągnięto limit pojedynczego eksperymentu ($${experimentSpentUsd.toFixed(4)} + ~$${projectedUsd.toFixed(4)} > $${spec.maxExperimentUsd.toFixed(4)}) — automatyczne zatrzymanie.`;
      saveLedger();
      const err = new Error(stopReason);
      err.code = "PROMO_EXPERIMENT_BUDGET_EXCEEDED";
      throw err;
    }

    if (ledger.totalSpentUsd + projectedUsd > spec.maxTotalUsd) {
      stopped = true;
      stopReason = `Osiągnięto całkowity limit kredytów promocyjnych ($${ledger.totalSpentUsd.toFixed(4)} + ~$${projectedUsd.toFixed(4)} > $${spec.maxTotalUsd.toFixed(4)}) — automatyczne zatrzymanie (brak przejścia na rozliczenie płatne).`;
      saveLedger();
      const err = new Error(stopReason);
      err.code = "PROMO_TOTAL_BUDGET_EXCEEDED";
      throw err;
    }

    return {
      ok: true,
      remainingExperimentUsd: Number((spec.maxExperimentUsd - experimentSpentUsd).toFixed(4)),
      remainingTotalUsd: Number((spec.maxTotalUsd - ledger.totalSpentUsd).toFixed(4)),
      remainingSeconds: Math.max(0, Math.round(spec.maxDurationSeconds - elapsedSec)),
    };
  }

  /** Zarejestruj rzeczywisty czas wywołania GPU (wraz z marginesem bezczynności) w księdze kredytów. */
  function recordUsage({ durationMs = 0, tokensIn = 0, tokensOut = 0, overheadSec = 2 } = {}) {
    const billableSec = Math.max(0.5, (Number(durationMs) / 1000) + Number(overheadSec || 0));
    const costUsd = (billableSec / 3600) * spec.gpuRateUsdPerHour;
    experimentSpentUsd = Number((experimentSpentUsd + costUsd).toFixed(6));
    ledger.totalSpentUsd = Number((ledger.totalSpentUsd + costUsd).toFixed(6));
    callsCount += 1;
    totalTokensIn += Number(tokensIn || 0);
    totalTokensOut += Number(tokensOut || 0);

    if (experimentSpentUsd >= spec.maxExperimentUsd) {
      stopped = true;
      stopReason = `Wyczerpano limit eksperymentu ($${experimentSpentUsd.toFixed(4)}/$${spec.maxExperimentUsd.toFixed(4)}).`;
    } else if (ledger.totalSpentUsd >= spec.maxTotalUsd) {
      stopped = true;
      stopReason = `Wyczerpano całkowity limit kredytów ($${ledger.totalSpentUsd.toFixed(4)}/$${spec.maxTotalUsd.toFixed(4)}).`;
    }
    saveLedger();
    return { costUsd: Number(costUsd.toFixed(6)), snapshot: getSnapshot() };
  }

  function getSnapshot() {
    return {
      category: COST_CATEGORIES.PROMO_CREDITS,
      experimentId: spec.experimentId,
      gpuSpec: spec.gpuSpec,
      gpuRateUsdPerHour: spec.gpuRateUsdPerHour,
      maxExperimentUsd: spec.maxExperimentUsd,
      maxTotalUsd: spec.maxTotalUsd,
      maxDurationSeconds: spec.maxDurationSeconds,
      allowPaidOverflow: false,
      experimentSpentUsd: Number(experimentSpentUsd.toFixed(5)),
      totalSpentUsd: Number(ledger.totalSpentUsd.toFixed(5)),
      elapsedSeconds: Number(getElapsedSeconds().toFixed(1)),
      callsCount,
      totalTokensIn,
      totalTokensOut,
      stopped,
      stopReason,
      billingVerified: Boolean(billingCheckResult?.verified),
      billedCostUsd: billingCheckResult?.billing?.billedCostUsd ?? null,
    };
  }

  return {
    spec,
    assertCanSpend,
    recordUsage,
    getSnapshot,
  };
}
