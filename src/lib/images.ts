import { store } from "./store";

export interface GenImage {
  data: string; // base64
  mediaType: string;
}
type Result = GenImage | { error: string };
type Img = { data: string; mediaType: string };

// Najpierw najlepszy darmowy edytor (Gemini 2.5 Flash Image „Nano Banana"),
// z fallbackiem na starszy model, gdy nowy jest niedostępny dla danego klucza.
const IMAGE_MODELS = ["gemini-2.5-flash-image-preview", "gemini-2.0-flash-preview-image-generation"];

async function callImageModel(model: string, key: string, parts: any[]): Promise<Result> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    },
  );
  const d = await res.json();
  if (!res.ok) return { error: d?.error?.message || `Błąd (${res.status}).` };
  const out: any[] = d.candidates?.[0]?.content?.parts || [];
  const imgPart = out.find((p) => p.inlineData);
  if (!imgPart) return { error: "Model nie zwrócił obrazu (spróbuj inny opis)." };
  return { data: imgPart.inlineData.data, mediaType: imgPart.inlineData.mimeType || "image/png" };
}

/**
 * Generowanie / precyzyjna edycja obrazu przez Gemini. Obsługuje jedno lub WIELE
 * zdjęć wejściowych (np. połącz osobę z tłem, przenieś detal między zdjęciami).
 */
export async function generateImage(prompt: string, input?: Img | Img[]): Promise<Result> {
  const key = store.settings.keys.gemini?.trim();
  if (!key) return { error: "Dodaj klucz Google Gemini w ⚙ — Studio obrazów korzysta z Gemini (darmowy tier)." };

  const inputs = input ? (Array.isArray(input) ? input : [input]) : [];
  const parts: any[] = [{ text: prompt }];
  for (const im of inputs) parts.push({ inlineData: { mimeType: im.mediaType, data: im.data } });

  let lastErr = "Nie udało się wygenerować obrazu.";
  for (const model of IMAGE_MODELS) {
    try {
      const r = await callImageModel(model, key, parts);
      if (!("error" in r)) return r;
      lastErr = r.error;
      // Model nieobsługiwany dla tego klucza → spróbuj kolejnego; inny błąd → zwróć od razu.
      if (!/not found|not supported|unknown|404|invalid model|permission|unavailable/i.test(r.error)) return r;
    } catch (e) {
      lastErr = `Błąd połączenia: ${e instanceof Error ? e.message : e}`;
    }
  }
  return { error: lastErr };
}
