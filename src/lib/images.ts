import { store } from "./store";

export interface GenImage {
  data: string; // base64
  mediaType: string;
}
type Result = GenImage | { error: string };

// Generowanie / edycja obrazu przez Gemini (image generation). Z opcjonalnym
// obrazem wejściowym = edycja ("zmień tło", "dodaj kapelusz", "w stylu...").
export async function generateImage(
  prompt: string,
  input?: { data: string; mediaType: string },
): Promise<Result> {
  const key = store.settings.keys.gemini?.trim();
  if (!key) return { error: "Dodaj klucz Google Gemini w ⚙ — Studio obrazów korzysta z Gemini (darmowy tier)." };

  const parts: any[] = [{ text: prompt }];
  if (input) parts.push({ inlineData: { mimeType: input.mediaType, data: input.data } });

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${key}`,
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
  } catch (e) {
    return { error: `Błąd połączenia: ${e instanceof Error ? e.message : e}` };
  }
}
