// === Ollama Maestro — premium, inteligentny lokalny mózg „pod klucz" ===
// Jeden ruch: wykryj domowy serwer Ollama, DOBIERZ najlepsze modele do ról (szybkość /
// inteligencja / wizja / bez cenzury), POBIERZ brakujące same na PC i WŁĄCZ premium-routing
// (lokalnie-najpierw + Brama Pewności + prewarm + adaptacja). Cel: najlepszy wynik względem
// szybkości i mądrości, prosto w obsłudze. Wszystko opt-in (odpalane świadomie przyciskiem).
import { store } from "./store";
import { detectOllama } from "./privateMode";
import { pullOllamaModel } from "./ollamaPull";

export interface RoleModel {
  role: "reflex" | "balanced" | "vision" | "uncensored";
  model: string;
  why: string; // krótkie uzasadnienie doboru (do UI)
}

// Kuracja pod ~4 GB VRAM (2026). Na mocniejszym GPU można podmienić na większe warianty.
export const PREMIUM_CATALOG: RoleModel[] = [
  { role: "reflex", model: "qwen3:1.7b", why: "błyskawiczne, proste tury (szybkość)" },
  { role: "balanced", model: "qwen3.5:4b", why: "najmądrzejszy ogólny 4B (inteligencja)" },
  { role: "vision", model: "gemma3:4b-it-qat", why: "lokalna wizja + 140 języków" },
  { role: "uncensored", model: "dolphin-mistral", why: "odpowiada wprost, bez moralizowania" },
];

const byRole = (role: RoleModel["role"]): string => PREMIUM_CATALOG.find((r) => r.role === role)!.model;

export interface PremiumOverrides {
  simple: string;
  complex: string;
  vision: string;
  uncensored: string;
}

/** Rekomendowane przypisanie modeli do ról (per typ zadania + bez cenzury). Czysta. */
export function recommendedOverrides(): PremiumOverrides {
  return { simple: byRole("reflex"), complex: byRole("balanced"), vision: byRole("vision"), uncensored: byRole("uncensored") };
}

/** Modele, które trzeba mieć na PC dla trybu premium (z cenzurą bez „uncensored"). Czysta. */
export function requiredModels(opts: { uncensored?: boolean } = {}): string[] {
  const o = recommendedOverrides();
  const base = [o.simple, o.complex, o.vision];
  return opts.uncensored ? [...base, o.uncensored] : base;
}

/** Których z `desired` brakuje wśród `installed` (tag ma znaczenie; nazwa bez tagu = dopasowanie bazowe). Czysta. */
export function missingModels(installed: string[], desired: string[]): string[] {
  const inst = installed.map((s) => s.toLowerCase());
  return desired.filter((d) => {
    const dl = d.toLowerCase();
    if (inst.includes(dl)) return false;
    if (!dl.includes(":")) return !inst.some((i) => i.split(":")[0] === dl); // bez tagu → wariant bazowy wystarczy
    return true; // z tagiem → wymagaj dokładnego (rozmiar się liczy)
  });
}

export interface PremiumSummary {
  overrides: PremiumOverrides;
  enabled: string[]; // które przełączniki premium włączono
}

/**
 * Włącz tryb premium lokalny: ustaw modele per rola + włącz inteligentny routing.
 * Tylko zapis ustawień (bez sieci) — pobieranie modeli robi `ensurePremiumModels`. Zwraca podsumowanie.
 */
export function applyPremiumSetup(opts: { uncensored?: boolean } = {}): PremiumSummary {
  const o = recommendedOverrides();
  store.setSettings({
    provider: "ollama",
    ollamaModelSimple: o.simple,
    ollamaModelComplex: o.complex,
    ollamaModelVision: o.vision,
    ollamaModelUncensored: o.uncensored,
    // Premium routing: szybko lokalnie, eskalacja gdy niepewne, gorący model, uczenie się.
    localFirstSimple: true,
    confidenceGate: true,
    prewarmLocal: true,
    adaptiveRouter: true,
    ...(opts.uncensored ? { unfilteredLocal: true } : {}),
  });
  const enabled = ["lokalnie-najpierw", "Brama Pewności", "prewarm", "adaptacja"];
  if (opts.uncensored) enabled.push("bez cenzury");
  return { overrides: o, enabled };
}

export interface EnsureResult {
  ok: boolean;
  installed: string[];
  pulled: string[];
  error?: string;
}

/**
 * Dopilnuj, by PC miał komplet modeli premium — wykryj zainstalowane i POBIERZ brakujące SAM
 * (z paskiem postępu przez `onProgress`). To jest „na PC pobierz sam".
 */
export async function ensurePremiumModels(opts: { uncensored?: boolean; onProgress?: (msg: string) => void } = {}): Promise<EnsureResult> {
  const det = await detectOllama(store.settings.ollamaUrl);
  if (!det.ok) return { ok: false, installed: [], pulled: [], error: det.error || "Nie połączono z Ollamą — sprawdź adres serwera." };

  const desired = requiredModels({ uncensored: opts.uncensored });
  const missing = missingModels(det.models, desired);
  if (!missing.length) {
    opts.onProgress?.("Komplet modeli już jest — gotowe.");
    return { ok: true, installed: det.models, pulled: [] };
  }

  const pulled: string[] = [];
  for (const m of missing) {
    opts.onProgress?.(`⬇ Pobieram ${m}…`);
    const r = await pullOllamaModel(m, (p) => opts.onProgress?.(`${m}: ${p.status}${p.percent != null ? ` ${p.percent}%` : ""}`));
    if (!r.ok) return { ok: false, installed: det.models, pulled, error: `Nie udało się pobrać ${m}: ${r.error}` };
    pulled.push(m);
  }
  opts.onProgress?.(`Gotowe — pobrano ${pulled.length} model(i).`);
  return { ok: true, installed: det.models, pulled };
}
