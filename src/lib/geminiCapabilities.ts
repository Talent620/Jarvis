// === Rejestr możliwości i modeli Gemini (capability-aware) ===
// Pobiera listę modeli z oficjalnego endpointu, cache'uje w IndexedDB (≤24 h) i wnioskuje
// możliwości każdego modelu (generateContent, wizja, function calling, structured output,
// tryb myślenia). Dzięki temu JARVIS dobiera NAJLEPSZY faktycznie dostępny model, ale NIE
// psuje się, gdy Google zmieni ofertę (brak sieci/listy → fallback do znanych modeli).
// Czyste funkcje (parse/infer/pick) są testowalne bez sieci. S9-safe (bez /u, \p, lookbehind).

import { idbGet, idbSet, idbAvailable } from "./db";
import { fetchTimeout } from "./http";
import type { ReasoningProfile } from "./providers/types";

export type IntelligenceMode = "economy" | "balanced" | "maximum";
export type ThinkingKind = "none" | "budget" | "level"; // 2.5 → budget, 3 → level

export interface GeminiModelCaps {
  id: string; // bez prefiksu "models/", np. "gemini-2.5-flash"
  generateContent: boolean;
  vision: boolean;
  functionCalling: boolean;
  structuredOutput: boolean;
  thinking: ThinkingKind;
  preview: boolean; // preview/exp/experimental — tylko po opt-in
  inputTokenLimit?: number;
}

// Fallback, gdy brak sieci/listy — pewne, stabilne modele (spójne z registry providerów).
export const FALLBACK_GEMINI_MODELS: GeminiModelCaps[] = [
  { id: "gemini-2.5-flash", generateContent: true, vision: true, functionCalling: true, structuredOutput: true, thinking: "budget", preview: false },
  { id: "gemini-2.5-flash-lite", generateContent: true, vision: true, functionCalling: true, structuredOutput: true, thinking: "budget", preview: false },
  { id: "gemini-2.5-pro", generateContent: true, vision: true, functionCalling: true, structuredOutput: true, thinking: "budget", preview: false },
  { id: "gemini-2.0-flash", generateContent: true, vision: true, functionCalling: true, structuredOutput: true, thinking: "none", preview: false },
];

const CACHE_KEY = "gemini.models.v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 h

/** Pure: czy id modelu to wersja preview/experimental (niestabilna)? */
export function isPreviewModel(id: string): boolean {
  return /preview|experimental|\bexp\b|-exp-/.test(id);
}

/** Pure: tryb myślenia wg rodziny modelu (3 → poziom, 2.5 → budżet, reszta → brak). */
export function thinkingKindFor(id: string): ThinkingKind {
  if (/gemini-3/.test(id)) return "level";
  if (/gemini-2\.5/.test(id)) return "budget";
  return "none";
}

/** Pure: czy model wspiera natywne Google Search grounding (aktualne dane ze źródłami)? */
export function supportsGrounding(modelId: string): boolean {
  return /gemini-(1\.5|2\.|2-|3)/.test(modelId) || /gemini-(flash|pro)/.test(modelId);
}

/**
 * Pure: zbuduj tablicę `tools` dla żądania Gemini tak, by NIGDY nie łączyć wbudowanego
 * googleSearch (grounding) z function calling w JEDNYM żądaniu — API zwraca wtedy 400
 * („Built-in tools and Function Calling cannot be combined"). Reguła „zawsze działa":
 *   • są narzędzia (function calling) → WYSYŁAMY function calling, grounding POMIJAMY
 *     (JARVIS i tak ma własne narzędzie web_research/research — świeże dane są osiągalne);
 *   • brak narzędzi, ale grounding chciany → wysyłamy sam googleSearch;
 *   • nic → brak pola tools.
 * Zwraca też `groundingSkipped`, żeby caller mógł to odnotować (telemetria/log), nie zgadując.
 */
export function geminiRequestTools(
  functionDeclarations: unknown[],
  useGrounding: boolean,
): { tools: unknown[] | undefined; groundingSkipped: boolean } {
  const hasFns = Array.isArray(functionDeclarations) && functionDeclarations.length > 0;
  if (hasFns) {
    // Function calling wygrywa — nigdy nie doklejamy googleSearch (to właśnie dawało 400).
    return { tools: [{ functionDeclarations }], groundingSkipped: useGrounding };
  }
  if (useGrounding) {
    return { tools: [{ googleSearch: {} }], groundingSkipped: false };
  }
  return { tools: undefined, groundingSkipped: false };
}

/**
 * Pure: wyłuskaj PRAWDZIWE źródła z groundingMetadata odpowiedzi Gemini (nie wymyślamy źródeł).
 * Zwraca [] gdy brak metadata — wtedy caller użyje zwykłego narzędzia research/web.
 */
export function parseGroundingCitations(data: unknown): { title: string; url: string }[] {
  const meta = (data as any)?.candidates?.[0]?.groundingMetadata;
  const chunks = meta?.groundingChunks;
  if (!Array.isArray(chunks)) return [];
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    const web = c?.web;
    const url = web?.uri || web?.url;
    if (!url || typeof url !== "string" || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: (typeof web.title === "string" && web.title) || url, url });
  }
  return out;
}

/** Pure: wywnioskuj możliwości z surowego wpisu modelu z API. */
export function inferCaps(raw: { name?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }): GeminiModelCaps | null {
  const full = (raw?.name || "").trim();
  const id = full.replace(/^models\//, "");
  if (!id || !/^gemini/.test(id)) return null; // pomijamy embeddingi/aqa/imagen/veo/tts itp.
  const methods = raw.supportedGenerationMethods || [];
  const generateContent = methods.length ? methods.includes("generateContent") : true;
  // Modele czatu Gemini (1.5+/2.x/3) są multimodalne i wspierają narzędzia + structured output.
  const modern = /gemini-(1\.5|2\.|2-|3)/.test(id) || /gemini-(flash|pro)/.test(id);
  return {
    id,
    generateContent,
    vision: true,
    functionCalling: modern,
    structuredOutput: modern,
    thinking: thinkingKindFor(id),
    preview: isPreviewModel(id),
    inputTokenLimit: raw.inputTokenLimit,
  };
}

/** Pure: zamień surową odpowiedź endpointu /models na listę możliwości (tylko modele czatu). */
export function parseGeminiModels(rawList: unknown): GeminiModelCaps[] {
  const arr = (rawList as { models?: unknown[] })?.models;
  if (!Array.isArray(arr)) return [];
  const out: GeminiModelCaps[] = [];
  for (const m of arr) {
    const caps = inferCaps(m as any);
    if (caps && caps.generateContent) out.push(caps);
  }
  return out;
}

/**
 * Pure: wybierz model do trybu inteligencji. Stabilne najpierw (preview tylko po opt-in).
 * economy → najszybszy/najtańszy; balanced → flash; maximum → najmocniejszy dostępny.
 * Nie używa aliasu "latest". Gdy nic nie pasuje — null (caller użyje fallbacku).
 */
export function pickGeminiModel(models: GeminiModelCaps[], mode: IntelligenceMode, allowPreview = false): string | null {
  const usable = models.filter((m) => m.generateContent && (allowPreview || !m.preview) && !/latest/.test(m.id));
  if (!usable.length) return null;
  const score = (m: GeminiModelCaps): number => {
    let s = 0;
    if (/pro/.test(m.id)) s += 100; // pro = najmocniejszy
    else if (/flash-lite/.test(m.id)) s += 30;
    else if (/flash/.test(m.id)) s += 60;
    // nowsza rodzina wyżej
    if (/gemini-3/.test(m.id)) s += 40;
    else if (/gemini-2\.5/.test(m.id)) s += 20;
    else if (/gemini-2/.test(m.id)) s += 10;
    return s;
  };
  if (mode === "maximum") {
    return [...usable].sort((a, b) => score(b) - score(a))[0].id;
  }
  if (mode === "economy") {
    // Najtańszy/najszybszy: preferuj flash-lite, potem flash, najmniejszy score.
    const lite = usable.find((m) => /flash-lite/.test(m.id) && /gemini-2\.5/.test(m.id))
      || usable.find((m) => /flash-lite/.test(m.id));
    if (lite) return lite.id;
    return [...usable].sort((a, b) => score(a) - score(b))[0].id;
  }
  // balanced — najlepszy flash (nie-pro, nie-lite), preferuj 2.5.
  const flash = usable.find((m) => /gemini-2\.5-flash$/.test(m.id))
    || usable.find((m) => /flash$/.test(m.id) && !/lite/.test(m.id))
    || usable.find((m) => /flash/.test(m.id) && !/lite/.test(m.id));
  return (flash || [...usable].sort((a, b) => score(b) - score(a))[0]).id;
}

/**
 * Pure: zbuduj `thinkingConfig` Gemini z profilu rozumowania, z CAPABILITY GATE —
 * model bez myślenia (none) dostaje null (nie wysyłamy nieobsługiwanego pola).
 * Gemini 3 → thinkingLevel; Gemini 2.5 → thinkingBudget (tokeny; high = dynamiczny -1).
 */
export function geminiThinkingConfig(modelId: string, profile: ReasoningProfile): Record<string, unknown> | null {
  const kind = thinkingKindFor(modelId);
  if (kind === "none") return null; // capability gate
  if (kind === "level") {
    const level = profile === "high" ? "high" : profile === "medium" ? "medium" : "low";
    return { thinkingLevel: level };
  }
  // budget (Gemini 2.5): high → dynamiczny (-1), medium → 2048, low → 512, minimal → 0.
  const budget = profile === "high" ? -1 : profile === "medium" ? 2048 : profile === "low" ? 512 : 0;
  return { thinkingBudget: budget };
}

/** Pobierz listę modeli z API (mockowalne przez fetchImpl). Rzuca przy 401/429/sieci. */
export async function fetchGeminiModels(
  apiKey: string,
  fetchImpl: (url: string) => Promise<Response> = (u) => fetchTimeout(u, {}, 12000),
): Promise<GeminiModelCaps[]> {
  const key = (apiKey || "").trim();
  if (!key) throw new Error("Brak klucza Gemini");
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
  if (!res.ok) throw new Error(`Gemini /models: HTTP ${res.status}`);
  const json = await res.json();
  return parseGeminiModels(json);
}

interface CacheRecord { at: number; models: GeminiModelCaps[] }

/**
 * Lista modeli z cache (≤24 h) albo z sieci, z bezpiecznym fallbackiem.
 * Brak sieci/listy/IDB → zawsze zwraca przynajmniej FALLBACK_GEMINI_MODELS (JARVIS nie blokuje się).
 */
export async function getGeminiModels(apiKey: string, now = Date.now(), forceRefresh = false): Promise<GeminiModelCaps[]> {
  if (!apiKey?.trim()) return FALLBACK_GEMINI_MODELS;
  if (!forceRefresh && idbAvailable()) {
    try {
      const cached = await idbGet<CacheRecord>(CACHE_KEY);
      if (cached && Array.isArray(cached.models) && cached.models.length && now - cached.at < MAX_AGE_MS) {
        return cached.models;
      }
    } catch { /* cache niedostępny — pobierz/fallback */ }
  }
  try {
    const models = await fetchGeminiModels(apiKey);
    if (models.length) {
      if (idbAvailable()) { try { await idbSet(CACHE_KEY, { at: now, models } as CacheRecord); } catch { /* ignore */ } }
      return models;
    }
  } catch { /* sieć/401/429 — fallback niżej */ }
  // Ostatnia deska ratunku: znane, stabilne modele (nie blokujemy JARVIS-a).
  return FALLBACK_GEMINI_MODELS;
}
