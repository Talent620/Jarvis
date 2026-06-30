import { runTool } from "../tools";
import { fetchTimeout, appTokenHeader } from "../http";
import { GeminiStreamAccumulator, drainSSE } from "../stream";
import type { AskCtx, JarvisReply } from "./types";
import { geminiThinkingConfig } from "../geminiCapabilities";

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
  functionCall?: { name: string; args: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; id?: string; response: { result: string } };
  /** Podpis rozumowania Gemini (thinking) — MUSI wrócić nietknięty w kolejnych krokach. */
  thoughtSignature?: string;
}

/** Pure: klucz tożsamości wywołania narzędzia (nazwa + argumenty) — do wykrywania pętli. */
export function callSignature(name: string, args: unknown): string {
  let a = "";
  try { a = JSON.stringify(args ?? {}); } catch { a = String(args); }
  return `${name}:${a}`;
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
  let inTok = 0;
  let outTok = 0;
  let guard = 0;
  // Strumieniujemy tylko BEZPOŚREDNIO (proxy /gemini mapuje na generateContent, nie SSE).
  let canStream = !!ctx.onToken && !ctx.proxyUrl;
  const headers = { "content-type": "application/json", ...(ctx.proxyUrl ? appTokenHeader() : {}) };
  const buildBody = (): any => {
    const reqBody: any = { systemInstruction: { parts: [{ text: ctx.system }] }, contents };
    if (functionDeclarations.length) reqBody.tools = [{ functionDeclarations }];
    // Adaptacyjne myślenie: profil → thinkingConfig (capability gate — model bez myślenia pomija pole).
    if (ctx.reasoningProfile) {
      const tc = geminiThinkingConfig(ctx.model, ctx.reasoningProfile);
      if (tc) reqBody.generationConfig = { ...(reqBody.generationConfig || {}), thinkingConfig: tc };
    }
    return reqBody;
  };

  // Pełna odpowiedź — ścieżka klasyczna / fallback.
  const requestFull = async (): Promise<Part[]> => {
    const res = await fetchTimeout(base, { method: "POST", headers, body: JSON.stringify(buildBody()) }, 120000);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);
    // thoughtsTokenCount (tokeny myślenia) liczą się do kosztu — dolicz do output.
    if (data.usageMetadata) { inTok += data.usageMetadata.promptTokenCount || 0; outTok += (data.usageMetadata.candidatesTokenCount || 0) + (data.usageMetadata.thoughtsTokenCount || 0); }
    return data.candidates?.[0]?.content?.parts || [];
  };

  // Strumieniowanie (SSE, tylko bezpośrednio) — tekst leci deltami; functionCall składamy.
  const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${ctx.model}:streamGenerateContent?alt=sse&key=${ctx.apiKey.trim()}`;
  const requestStream = async (): Promise<Part[]> => {
    const res = await fetchTimeout(streamUrl, { method: "POST", headers, body: JSON.stringify(buildBody()) }, 120000);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("stream-unsupported");
    const dec = new TextDecoder();
    const acc = new GeminiStreamAccumulator();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const { events, rest } = drainSSE(buf);
      buf = rest;
      for (const ev of events) { const delta = acc.push(ev); if (delta) ctx.onToken?.(delta); }
    }
    const tail = drainSSE(buf + "\n\n");
    for (const ev of tail.events) { const delta = acc.push(ev); if (delta) ctx.onToken?.(delta); }
    inTok += acc.usage.inputTokens; outTok += acc.usage.outputTokens;
    return [
      ...(acc.text ? [{ text: acc.text } as Part] : []),
      ...acc.calls().map((c) => {
        const fc: Part["functionCall"] = { name: c.name, args: (c.args as Record<string, unknown>) || {} };
        if (c.id) fc.id = c.id;
        const part: Part = { functionCall: fc };
        if (c.thoughtSignature) part.thoughtSignature = c.thoughtSignature; // zachowaj plan modelu
        return part;
      }),
    ];
  };

  const seenCalls = new Set<string>(); // tożsamości wywołań (nazwa+argumenty) — anty-zapętlenie
  while (guard++ < 8) {
    let parts: Part[];
    try {
      parts = canStream ? await requestStream() : await requestFull();
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      if (canStream && !/timeout|abort|failed to fetch|load failed|network/i.test(em)) {
        canStream = false; guard--; continue; // hiccup strumienia → pełna odpowiedź
      }
      throw e;
    }
    contents.push({ role: "model", parts });

    const calls = parts.filter((p) => p.functionCall);
    if (calls.length) {
      const responseParts: Part[] = [];
      for (const c of calls) {
        const name = c.functionCall!.name;
        const sig = callSignature(name, c.functionCall!.args);
        // Wykryj zapętlenie: IDENTYCZNE powtórzone wywołanie (ta sama nazwa+argumenty) → przerwij czytelnie.
        if (seenCalls.has(sig)) {
          return { text: `Przerwałem — narzędzie „${name}" było wywoływane w kółko z tymi samymi danymi.`, tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok } };
        }
        seenCalls.add(sig);
        used.add(name);
        const out = await runTool(name, c.functionCall!.args || {});
        const rp: Part = { functionResponse: { name, response: { result: out } } };
        if (c.functionCall!.id) rp.functionResponse!.id = c.functionCall!.id; // dopasuj odpowiedź do wywołania
        responseParts.push(rp);
      }
      contents.push({ role: "user", parts: responseParts });
      continue;
    }

    const text = parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("")
      .trim();
    return { text: text || "…", tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok } };
  }
  return { text: "Zapętliłem się przy realizacji zadania.", tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok } };
}
