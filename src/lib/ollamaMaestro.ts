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
    // Premium routing: szybko lokalnie, eskalacja gdy niepewne, gorący model, uczenie się,
    // oraz lokalna samokorekta złożonych odpowiedzi (Drabina Mądrości).
    localFirstSimple: true,
    confidenceGate: true,
    prewarmLocal: true,
    adaptiveRouter: true,
    localRefine: true,
    ...(opts.uncensored ? { unfilteredLocal: true } : {}),
  });
  const enabled = ["lokalnie-najpierw", "Brama Pewności", "prewarm", "adaptacja", "Drabina Mądrości"];
  if (opts.uncensored) enabled.push("bez cenzury");
  return { overrides: o, enabled };
}

// === Klikalny katalog do dodawania modeli (łatwiej niż wpisywanie nazwy) ===
export interface CatalogModel { id: string; role: string; size: string; desc: string }
export const ADDABLE_MODELS: CatalogModel[] = [
  { id: "qwen3:1.7b", role: "szybki", size: "~1.4 GB", desc: "Refleks — błyskawiczne, proste tury" },
  { id: "qwen3.5:4b", role: "mądry", size: "~2.7 GB", desc: "Najlepszy ogólny 4B (domyślny)" },
  { id: "gemma3:4b-it-qat", role: "wizja", size: "~3 GB", desc: "Widzi obrazy + 140 języków" },
  { id: "llama3.2:3b", role: "szybki", size: "~2 GB", desc: "Szybki, dobre narzędzia" },
  { id: "phi4-mini", role: "mądry", size: "~2.8 GB", desc: "Mocne rozumowanie" },
  { id: "deepseek-r1:1.5b", role: "myślenie", size: "~1.2 GB", desc: "Łańcuch myśli / matematyka" },
  { id: "qwen2.5-coder:3b", role: "kod", size: "~2 GB", desc: "Programowanie lokalnie" },
  { id: "gemma2:2b", role: "szybki", size: "~1.7 GB", desc: "Najszybszy na CPU" },
  { id: "dolphin-mistral", role: "bez cenzury", size: "~4 GB", desc: "Odpowiada wprost, bez moralizowania" },
  // Wizja (rozumienie/opis/OCR obrazu — NIE generowanie). Generowanie obrazów robi Studio (chmura).
  { id: "moondream", role: "wizja", size: "~1.8 GB", desc: "Malutki, szybki podpis do obrazu (mało VRAM)" },
  { id: "llava:7b", role: "wizja", size: "~4.7 GB", desc: "Klasyczny opis obrazów, lekki" },
  { id: "minicpm-v", role: "wizja", size: "~5.5 GB", desc: "Najlepsze OCR i detale — tekst na obrazie, dokumenty" },
  { id: "llama3.2-vision", role: "wizja", size: "~7.8 GB", desc: "Topowa wizja ogólna (opis, analiza) — wymaga ~8 GB VRAM" },
];

// === Auto-dobór ról z modeli JUŻ zainstalowanych (najlepsze ustawienia z tego, co masz) ===
/** Szacuje rozmiar modelu (mld parametrów) z tagu nazwy, np. „qwen3.5:4b" → 4. Czysta. */
export function paramB(name: string): number {
  const m = name.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b(?:[^a-z0-9]|$)/);
  return m ? parseFloat(m[1]) : 0;
}
const isVision = (n: string): boolean => /llava|vision|gemma3|minicpm-v|bakllava|moondream|internvl|cogvlm|qwen2(\.5)?-?vl|pixtral/i.test(n);
const isUncensored = (n: string): boolean => /dolphin|uncensored|wizard-vicuna|abliterated/i.test(n);
const isCoder = (n: string): boolean => /coder|codellama|code-/i.test(n);

/** Przypisz role (szybki/mądry/wizja/bez-cenzury) do modeli ZAINSTALOWANYCH. Czysta. „" = brak. */
export function autoAssignRoles(installed: string[]): PremiumOverrides {
  const general = installed.filter((n) => !isVision(n) && !isUncensored(n) && !isCoder(n));
  const bySize = [...general].sort((a, b) => paramB(a) - paramB(b));
  const vision = installed.find(isVision) || "";
  const uncensored = installed.find(isUncensored) || "";
  // Nigdy nie zostawiaj „" dla simple/complex, gdy COKOLWIEK jest zainstalowane — inaczej routing
  // spadłby na model z katalogu, którego użytkownik może NIE mieć. Lepszy jest realny, choć nie-„ogólny".
  const fallback = general[0] || vision || installed.find((n) => !isUncensored(n)) || installed[0] || "";
  return {
    simple: bySize[0] || fallback, // najmniejszy ogólny = najszybszy
    complex: bySize[bySize.length - 1] || bySize[0] || fallback, // największy ogólny = najmądrzejszy
    vision,
    uncensored,
  };
}

/**
 * Skonfiguruj się SAM z modeli już obecnych na serwerze: dobierz role + włącz premium-routing,
 * bez pobierania czegokolwiek. Idealne, gdy masz już jakieś modele. Czyta sieć (detectOllama).
 */
export async function applyAutoFromInstalled(): Promise<{ ok: boolean; overrides?: PremiumOverrides; error?: string }> {
  const det = await detectOllama(store.settings.ollamaUrl);
  if (!det.ok) return { ok: false, error: det.error || "Nie połączono z Ollamą — sprawdź adres serwera." };
  if (!det.models.length) return { ok: false, error: "Brak modeli na serwerze — najpierw pobierz przynajmniej jeden." };
  const o = autoAssignRoles(det.models);
  store.setSettings({
    provider: "ollama",
    ollamaModelSimple: o.simple,
    ollamaModelComplex: o.complex,
    ollamaModelVision: o.vision,
    ollamaModelUncensored: o.uncensored,
    localFirstSimple: true,
    confidenceGate: true,
    prewarmLocal: true,
    adaptiveRouter: true,
    localRefine: true,
  });
  return { ok: true, overrides: o };
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
