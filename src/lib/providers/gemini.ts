import { runTool } from "../tools";
import { fetchTimeout } from "../http";
import type { AskCtx, JarvisReply } from "./types";

// Gemini odrzuca niektóre pola JSON Schema (np. additionalProperties) — także
// w zagnieżdżonych obiektach/tablicach. Usuwamy je rekurencyjnie.
function sanitize(node: any): any {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node && typeof node === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "additionalProperties" || k === "$schema") continue;
      out[k] = sanitize(v);
    }
    return out;
  }
  return node;
}

function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  const props = (schema.properties as Record<string, unknown>) || {};
  if (Object.keys(props).length === 0) return undefined; // brak argumentów -> bez parameters
  return sanitize({
    type: "object",
    properties: props,
    required: (schema.required as string[]) || [],
  });
}

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: string } };
}
interface Content {
  role: "user" | "model";
  parts: Part[];
}

// Adapter Google Gemini (AI Studio) — format contents/parts + functionDeclarations.
export async function askGemini(ctx: AskCtx): Promise<JarvisReply> {
  // Bez proxy klucz idzie w URL — pusty/niepełny klucz daje mylący błąd Google
  // („Expected OAuth 2 access token"). Złap to od razu, z czytelnym komunikatem.
  if (!ctx.proxyUrl && !ctx.apiKey?.trim()) {
    throw new Error("Brak klucza Google Gemini (401). Wklej klucz w ⚙ → AI (Szybki start).");
  }
  const base = ctx.proxyUrl
    ? `${ctx.proxyUrl}/gemini?model=${ctx.model}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${ctx.model}:generateContent?key=${ctx.apiKey.trim()}`;

  const functionDeclarations = ctx.tools.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: cleanSchema(d.input_schema),
  }));

  const contents: Content[] = ctx.history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: m.image
      ? [
          { inlineData: { mimeType: m.image.mediaType, data: m.image.data } } as Part,
          { text: m.content || "Opisz, co widzisz na zdjęciu." },
        ]
      : [{ text: m.content }],
  }));
  const used = new Set<string>();
  let guard = 0;

  while (guard++ < 8) {
    const reqBody: any = { systemInstruction: { parts: [{ text: ctx.system }] }, contents };
    if (functionDeclarations.length) reqBody.tools = [{ functionDeclarations }];
    const res = await fetchTimeout(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(reqBody),
    }, 120000);
    const data = await res.json().catch(() => null);
    // Dołącz kod HTTP do treści — inaczej logika awaryjna (rotacja klucza /
    // przełączenie dostawcy) nie rozpozna 401/403/429 ukrytych w samym tekście.
    if (!res.ok) throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);

    const parts: Part[] = data.candidates?.[0]?.content?.parts || [];
    contents.push({ role: "model", parts });

    const calls = parts.filter((p) => p.functionCall);
    if (calls.length) {
      const responseParts: Part[] = [];
      for (const c of calls) {
        const name = c.functionCall!.name;
        used.add(name);
        const out = await runTool(name, c.functionCall!.args || {});
        responseParts.push({ functionResponse: { name, response: { result: out } } });
      }
      contents.push({ role: "user", parts: responseParts });
      continue;
    }

    const text = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("")
      .trim();
    return { text: text || "…", tools: [...used] };
  }
  return { text: "Zapętliłem się przy realizacji zadania.", tools: [...used] };
}
