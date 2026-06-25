import { orderedKeys, studioKeyList, coolDownKey } from "./keys";
import { store } from "./store";
import { humanize } from "./aiHelpers";
import { fetchTimeout } from "./http";
import { localSdGenerate, type SdOpts } from "./localImage";
import { recordUsage } from "./usageTelemetry";
import type { ProviderId } from "./providers/types";

// Szacowany koszt za jeden obraz (USD) — do licznika wydatków. fal.ai liczy za sztukę.
const FAL_COST: Record<string, number> = { "fal-flux-kontext": 0.04, "fal-nano-banana": 0.08 };

export interface GenImage {
  data: string; // base64
  mediaType: string;
}
type Result = GenImage | { error: string };
type Img = { data: string; mediaType: string };

// === Modele edycji obrazu (darmowe + premium) ===
// Wybór modelu do edycji. Darmowy: Gemini „Nano Banana" (czołówka 2026, klucz
// Gemini z darmowym tierem). Premium: FLUX.1 Kontext / Nano Banana Pro przez fal.ai
// (płatne, ~$0.03–0.08 za obraz, wymaga klucza fal.ai) — najmocniejsza spójność
// detali przy wielokrotnej edycji.
export type ImageModelId = "pollinations" | "gemini" | "fal-flux-kontext" | "fal-nano-banana" | "local-sd";

export interface ImageModelMeta {
  id: ImageModelId;
  label: string;
  tier: "free" | "premium";
  note: string;
}

export const IMAGE_MODELS_LIST: ImageModelMeta[] = [
  { id: "pollinations", label: "Pollinations (darmowy, bez klucza)", tier: "free", note: "W pełni za darmo — bez klucza i bez logowania. Tworzy obraz z opisu (FLUX). Nie edytuje istniejących zdjęć." },
  { id: "gemini", label: "Gemini Nano Banana", tier: "free", note: "Darmowy (klucz Gemini). Topowy edytor opisem — czołówka 2026." },
  { id: "fal-flux-kontext", label: "FLUX.1 Kontext Pro", tier: "premium", note: "Najlepsza spójność detali przy wielu edycjach. fal.ai, płatny (~$0.04/obraz)." },
  { id: "fal-nano-banana", label: "Nano Banana Pro", tier: "premium", note: "Najmocniejszy edytor Google przez fal.ai. Płatny (~$0.08/obraz)." },
  { id: "local-sd", label: "Lokalny (Stable Diffusion)", tier: "free", note: "Na Twoim PC (A1111/Forge) — za darmo, offline, bez limitów. Wymaga adresu serwera w ⚙ → AI." },
];

/** Koszt jednego obrazu w USD dla danego modelu (0 = darmowy). Do jednoznacznego pokazania ceny w UI. */
export function imageModelCost(id: ImageModelId): number {
  return FAL_COST[id] || 0;
}

// Gemini „Nano Banana" — różne klucze mają dostęp do różnych nazw; próbujemy po kolei.
const GEMINI_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
];

async function callGemini(model: string, key: string, parts: any[]): Promise<Result> {
  const res = await fetchTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    },
    120000,
  );
  const d = await res.json().catch(() => null);
  if (!res.ok || !d) return { error: d?.error?.message || `Błąd (${res.status}).` };
  const out: any[] = d.candidates?.[0]?.content?.parts || [];
  const imgPart = out.find((p) => p.inlineData);
  if (!imgPart) return { error: "Model nie zwrócił obrazu (spróbuj inny opis)." };
  return { data: imgPart.inlineData.data, mediaType: imgPart.inlineData.mimeType || "image/png" };
}

// Limit/wyczerpana pula danego klucza → próbujemy następnego klucza (rotacja).
const isQuota = (m: string) => /quota|exceeded|rate.?limit|resource exhausted|too many requests|\b429\b/i.test(m);
// Brak/niewłaściwy model → próbujemy kolejnej nazwy modelu (ten sam klucz).
const isModelMiss = (m: string) => /not found|not supported|unknown|404|invalid model|permission|unavailable/i.test(m);

// Kotwica edycji: terse polecenia („wyczyść", „usuń rysy") potrafią zepchnąć Nano Banana
// w stronę tworzenia NOWEGO obrazu zamiast wiernej edycji. Gdy jest zdjęcie wejściowe,
// wyraźnie zakotwiczamy je jako materiał do PRZERÓBKI (zachowaj kadr i resztę bez zmian).
/** Pure: zbuduj prompt dla Gemini — z kotwicą edycji, gdy dołączono zdjęcie. */
export function geminiEditPrompt(prompt: string, hasInput: boolean): string {
  if (!hasInput) return prompt;
  return `Przerób DOŁĄCZONE zdjęcie według polecenia. Zachowaj ten sam przedmiot, kadr i kompozycję — zmień TYLKO to, o co proszę, fotorealistycznie, bez śladu edycji. Nie twórz nowej, niepowiązanej sceny. Polecenie: ${prompt}`;
}

async function geminiEdit(prompt: string, inputs: Img[]): Promise<Result> {
  // Studio ma WŁASNĄ pulę kluczy (studioKeys). Gdy pusta — używa zwykłych kluczy Gemini.
  const keys = studioKeyList().length ? studioKeyList() : orderedKeys("gemini");
  if (!keys.length) return { error: "Dodaj darmowy klucz Gemini (w Studiu: 🔑 albo ⚙ → AI) — edytor obrazów korzysta z Gemini (Nano Banana)." };
  const parts: any[] = [{ text: geminiEditPrompt(prompt, inputs.length > 0) }];
  for (const im of inputs) parts.push({ inlineData: { mimeType: im.mediaType, data: im.data } });
  let lastErr = "Nie udało się wygenerować obrazu.";
  for (const key of keys) {
    let quotaHit = false;
    for (const model of GEMINI_MODELS) {
      try {
        const r = await callGemini(model, key, parts);
        if (!("error" in r)) return r;
        lastErr = r.error;
        if (isQuota(r.error)) { coolDownKey("gemini", key); quotaHit = true; break; } // → następny klucz
        if (!isModelMiss(r.error)) return r; // twardy błąd (np. zły opis) — nie ma sensu rotować
        // model nieobsługiwany tym kluczem → spróbuj kolejnej nazwy modelu
      } catch (e) {
        lastErr = `Błąd połączenia: ${e instanceof Error ? e.message : e}`;
      }
    }
    if (!quotaHit) break; // wyczerpaliśmy modele bez limitu — kolejny klucz nic nie da
  }
  return { error: lastErr };
}

// --- fal.ai (premium) ---
const FAL_ENDPOINT: Record<string, string> = {
  "fal-flux-kontext": "fal-ai/flux-pro/kontext",
  "fal-nano-banana": "fal-ai/nano-banana/edit",
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function viaProxy(url: string): string {
  const proxy = store.settings.proxyUrl?.trim();
  return proxy ? `${proxy.replace(/\/$/, "")}/passthrough?u=${encodeURIComponent(url)}` : url;
}

async function falEdit(modelId: ImageModelId, prompt: string, inputs: Img[]): Promise<Result> {
  // Oczyść klucz z UKRYTYCH znaków nie-ASCII (zero-width, BOM, miękki łącznik) — przy kopiowaniu
  // z czatu/zrzutu wkradają się i wywalają budowę nagłówka HTTP („non ISO-8859-1 code point").
  const key = (store.settings.falApiKey || "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!key) return { error: "Model premium wymaga klucza fal.ai — dodaj go w ⚙ → AI (Studio premium)." };
  if (!inputs.length) return { error: "Modele premium edytują istniejące zdjęcie — najpierw dołącz zdjęcie." };
  const endpoint = FAL_ENDPOINT[modelId];
  const imageUri = `data:${inputs[0].mediaType};base64,${inputs[0].data}`;
  const body: any = { prompt, image_url: imageUri, num_images: 1 };
  // FLUX Kontext przyjmuje pojedynczy obraz; Nano Banana edit — listę.
  if (modelId === "fal-nano-banana") body.image_urls = inputs.map((i) => `data:${i.mediaType};base64,${i.data}`);
  try {
    const res = await fetchTimeout(viaProxy(`https://fal.run/${endpoint}`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${key}` },
      body: JSON.stringify(body),
    }, 120000);
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) {
      const raw = d?.detail?.[0]?.msg || d?.detail || d?.error || `Błąd fal.ai (${res.status}).`;
      const auth = res.status === 401 || res.status === 403 || /auth|access|unauthor/i.test(String(raw));
      return {
        error: auth
          ? `${raw}\n\nNano Banana Pro / FLUX to modele PŁATNE (fal.ai) — wymagają WAŻNEGO klucza fal.ai z włączonym billingiem. Do DARMOWEJ edycji zdjęć wybierz „🆓 Gemini Nano Banana” w wyborze modelu wyżej.`
          : raw,
      };
    }
    const imgUrl = d.images?.[0]?.url || d.image?.url;
    if (!imgUrl) return { error: "fal.ai nie zwrócił obrazu." };
    const ir = await fetchTimeout(viaProxy(imgUrl), {}, 60000);
    if (!ir.ok) return { error: "Nie udało się pobrać wyniku z fal.ai." };
    const blob = await ir.blob();
    // Zalicz koszt do licznika wydatków (fal.ai = za obraz). Liczba obrazów: tyle, ile zwrócił.
    const n = Array.isArray(d.images) ? d.images.length : 1;
    recordUsage({ at: Date.now(), provider: "fal" as ProviderId, model: FAL_ENDPOINT[modelId] || modelId, inputTokens: 0, outputTokens: 0, costUsd: (FAL_COST[modelId] || 0) * n });
    return { data: await blobToBase64(blob), mediaType: blob.type || "image/png" };
  } catch (e) {
    return { error: `Błąd fal.ai: ${e instanceof Error ? e.message : e}` };
  }
}

// --- Pollinations.ai (darmowy, BEZ klucza) — generowanie z opisu (text-to-image, FLUX) ---
const POLLINATIONS = "https://image.pollinations.ai/prompt/";

/** Pure: zbuduj URL Pollinations (do testów i podglądu). */
export function pollinationsUrl(prompt: string, opts?: SdOpts, seed = 0): string {
  const w = opts?.width || 1024;
  const h = opts?.height || 1024;
  const p = encodeURIComponent((prompt || "").slice(0, 1500));
  return `${POLLINATIONS}${p}?width=${w}&height=${h}&seed=${seed}&model=flux&nologo=true`;
}

async function pollinationsGenerate(prompt: string, inputs: Img[], opts?: SdOpts): Promise<Result> {
  // STRAŻNIK EDYCJI: darmowy generator robi text-to-image i NIE przerobi dołączonego zdjęcia.
  // Bez tej bramki tworzył z opisu zupełnie niepasujący obraz (np. „wyczyść" → losowy obraz),
  // udając edycję. Lepiej jasno pokierować niż oddać zmyślony wynik.
  if (inputs.length) return { error: "Darmowy generator bez klucza tworzy NOWY obraz z opisu i NIE przerobi dołączonego zdjęcia — dlatego wynik nie pasuje do oryginału. Aby PRZEROBIĆ to zdjęcie: dodaj darmowy klucz Gemini (🔑 w Studiu lub ⚙ → AI) i wybierz model „Gemini Nano Banana”, albo użyj lokalnego Stable Diffusion lub modelu premium (fal.ai)." };
  if (!prompt.trim()) return { error: "Podaj opis obrazu." };
  const seed = Math.floor(Math.random() * 1_000_000_000);
  try {
    const res = await fetchTimeout(viaProxy(pollinationsUrl(prompt, opts, seed)), {}, 120000);
    if (!res.ok) return { error: `Darmowy generator zwrócił błąd (${res.status}). Spróbuj ponownie za chwilę.` };
    const blob = await res.blob();
    if (!blob.size || !/^image\//i.test(blob.type || "")) {
      return { error: "Darmowy generator nie zwrócił obrazu — spróbuj ponownie albo zmień opis." };
    }
    return { data: await blobToBase64(blob), mediaType: blob.type || "image/jpeg" };
  } catch (e) {
    return { error: `Błąd połączenia z darmowym generatorem: ${e instanceof Error ? e.message : e}` };
  }
}

/** Pure: dobierz najlepszy DOSTĘPNY model wg konfiguracji (SD > Gemini > darmowy bez klucza). */
export function bestImageModel(forEdit = false): ImageModelId {
  const s = store.settings;
  if (s.sdUrl?.trim()) return "local-sd"; // własny serwer — najlepsza jakość, bez limitów
  // Masz skonfigurowany płatny fal.ai → to Twój domyślny EDYTOR (po to dodałeś klucz + kartę).
  // Dotyczy TYLKO edycji: fal edytuje istniejące zdjęcie; do generowania z opisu zostają darmowe modele.
  if (forEdit && s.falApiKey?.trim()) return "fal-flux-kontext";
  if (studioKeyList().length || orderedKeys("gemini").length) return "gemini"; // darmowy z kluczem, edytuje zdjęcia
  return "pollinations"; // zawsze działa, bez klucza
}

/**
 * Generowanie / precyzyjna edycja obrazu. Darmowo bez klucza (Pollinations), z kluczem Gemini
 * (Nano Banana — edycja zdjęć), lokalnie (SD) albo premium (fal.ai). Obsługuje wiele zdjęć wejściowych.
 */
export async function generateImage(prompt: string, input?: Img | Img[], model: ImageModelId = "gemini", sdOpts?: SdOpts, onSdProgress?: (pct: number) => void): Promise<Result> {
  const inputs = input ? (Array.isArray(input) ? input : [input]) : [];
  if (model === "pollinations") return pollinationsGenerate(prompt, inputs, sdOpts);
  if (model === "gemini") return geminiEdit(prompt, inputs);
  if (model === "local-sd") return localSdGenerate(prompt, inputs, sdOpts, onSdProgress);
  return falEdit(model, prompt, inputs);
}

/**
 * Zamień techniczny błąd z API na zrozumiały, polski komunikat do pokazania w Studiu.
 * Specjalny przypadek: wyczerpany darmowy limit Gemini → jasna podpowiedź (a nie
 * surowy angielski „You exceeded your current quota…").
 */
export function humanizeImageError(msg: string, model: ImageModelId): string {
  if (model === "gemini" && /quota|exceeded|rate.?limit|resource exhausted|\b429\b/i.test(msg))
    return "Darmowy limit Gemini wyczerpał się na teraz. Spróbuj za chwilę, dodaj drugi klucz Gemini w ⚙ → AI, albo wybierz model premium (fal.ai).";
  return humanize(msg);
}
