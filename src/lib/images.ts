import { orderedKeys, studioKeyList, coolDownKey } from "./keys";
import { store } from "./store";
import { humanize } from "./aiHelpers";

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
export type ImageModelId = "gemini" | "fal-flux-kontext" | "fal-nano-banana";

export interface ImageModelMeta {
  id: ImageModelId;
  label: string;
  tier: "free" | "premium";
  note: string;
}

export const IMAGE_MODELS_LIST: ImageModelMeta[] = [
  { id: "gemini", label: "Gemini Nano Banana", tier: "free", note: "Darmowy (klucz Gemini). Topowy edytor opisem — czołówka 2026." },
  { id: "fal-flux-kontext", label: "FLUX.1 Kontext Pro", tier: "premium", note: "Najlepsza spójność detali przy wielu edycjach. fal.ai, płatny (~$0.04/obraz)." },
  { id: "fal-nano-banana", label: "Nano Banana Pro", tier: "premium", note: "Najmocniejszy edytor Google przez fal.ai. Płatny (~$0.08/obraz)." },
];

// Gemini „Nano Banana" — różne klucze mają dostęp do różnych nazw; próbujemy po kolei.
const GEMINI_MODELS = [
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-image-preview",
  "gemini-2.0-flash-preview-image-generation",
];

async function callGemini(model: string, key: string, parts: any[]): Promise<Result> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    },
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

async function geminiEdit(prompt: string, inputs: Img[]): Promise<Result> {
  // Studio ma WŁASNĄ pulę kluczy (studioKeys). Gdy pusta — używa zwykłych kluczy Gemini.
  const keys = studioKeyList().length ? studioKeyList() : orderedKeys("gemini");
  if (!keys.length) return { error: "Dodaj darmowy klucz Gemini (w Studiu: 🔑 albo ⚙ → AI) — edytor obrazów korzysta z Gemini (Nano Banana)." };
  const parts: any[] = [{ text: prompt }];
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
  const key = store.settings.falApiKey?.trim();
  if (!key) return { error: "Model premium wymaga klucza fal.ai — dodaj go w ⚙ → AI (Studio premium)." };
  if (!inputs.length) return { error: "Modele premium edytują istniejące zdjęcie — najpierw dołącz zdjęcie." };
  const endpoint = FAL_ENDPOINT[modelId];
  const imageUri = `data:${inputs[0].mediaType};base64,${inputs[0].data}`;
  const body: any = { prompt, image_url: imageUri, num_images: 1 };
  // FLUX Kontext przyjmuje pojedynczy obraz; Nano Banana edit — listę.
  if (modelId === "fal-nano-banana") body.image_urls = inputs.map((i) => `data:${i.mediaType};base64,${i.data}`);
  try {
    const res = await fetch(viaProxy(`https://fal.run/${endpoint}`), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Key ${key}` },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return { error: d?.detail?.[0]?.msg || d?.detail || d?.error || `Błąd fal.ai (${res.status}).` };
    const imgUrl = d.images?.[0]?.url || d.image?.url;
    if (!imgUrl) return { error: "fal.ai nie zwrócił obrazu." };
    const ir = await fetch(viaProxy(imgUrl));
    if (!ir.ok) return { error: "Nie udało się pobrać wyniku z fal.ai." };
    const blob = await ir.blob();
    return { data: await blobToBase64(blob), mediaType: blob.type || "image/png" };
  } catch (e) {
    return { error: `Błąd fal.ai: ${e instanceof Error ? e.message : e}` };
  }
}

/**
 * Generowanie / precyzyjna edycja obrazu. Domyślnie darmowy Gemini (Nano Banana);
 * można wybrać model premium (fal.ai). Obsługuje wiele zdjęć wejściowych.
 */
export async function generateImage(prompt: string, input?: Img | Img[], model: ImageModelId = "gemini"): Promise<Result> {
  const inputs = input ? (Array.isArray(input) ? input : [input]) : [];
  if (model === "gemini") return geminiEdit(prompt, inputs);
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
