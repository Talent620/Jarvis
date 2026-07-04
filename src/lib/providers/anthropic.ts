import { runTool } from "../tools";
import { fetchTimeout, appTokenHeader } from "../http";
import { AnthStreamAccumulator, drainSSE } from "../stream";
import type { AskCtx, JarvisReply } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";

interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface Resp {
  content: Block[];
  stop_reason: string;
  error?: { message: string };
  usage?: { input_tokens?: number; output_tokens?: number };
}
type AnthMsg = { role: "user" | "assistant"; content: any };

// Natywny adapter Claude — pełny tool-use + serwerowe wyszukiwanie w sieci.
export async function askAnthropic(ctx: AskCtx): Promise<JarvisReply> {
  const endpoint = ctx.proxyUrl ? `${ctx.proxyUrl}/anthropic` : API_URL;
  const tools: any[] = ctx.tools.map((d) => ({
    name: d.name,
    description: d.description,
    input_schema: d.input_schema,
  }));
  if (ctx.webSearch) tools.push({ type: "web_search_20260209", name: "web_search" });

  const messages: AnthMsg[] = ctx.history.map((m) => ({
    role: m.role,
    content: m.image
      ? [
          { type: "image", source: { type: "base64", media_type: m.image.mediaType, data: m.image.data } },
          { type: "text", text: m.content || "Opisz, co widzisz na zdjęciu." },
        ]
      : m.content,
  }));
  const used = new Set<string>();
  let inTok = 0;
  let outTok = 0;
  let guard = 0;
  // Niektóre modele/bramki nie przyjmują adaptacyjnego myślenia ani „effort".
  // Zaczynamy z nimi (najlepsza jakość), a przy błędzie 400 o ich braku — ponawiamy bez nich.
  // W trybie szybkim (ctx.fast) ORAZ przy STRUMIENIOWANIU pomijamy myślenie: niższe opóźnienie
  // i brak potrzeby rekonstrukcji bloków „thinking" (tury z narzędziami pozostają poprawne).
  let richThinking = !ctx.fast && !ctx.onToken;
  let canStream = !!ctx.onToken;

  const headers = {
    "content-type": "application/json",
    "x-api-key": ctx.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
    ...(ctx.proxyUrl ? appTokenHeader() : {}),
  };
  const buildBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = { model: ctx.model, max_tokens: 8192, system: ctx.system, tools, messages };
    if (richThinking) { body.thinking = { type: "adaptive" }; body.output_config = { effort: "high" }; }
    return body;
  };

  // Pełna odpowiedź (bez strumienia) — ścieżka klasyczna / fallback.
  const requestFull = async (): Promise<{ content: Block[]; stop_reason: string }> => {
    const res = await fetchTimeout(endpoint, { method: "POST", headers, body: JSON.stringify(buildBody()) }, 120000);
    const data = (await res.json().catch(() => null)) as Resp | null;
    if (!res.ok || !data) throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);
    if (data.usage) { inTok += data.usage.input_tokens || 0; outTok += data.usage.output_tokens || 0; }
    return { content: data.content, stop_reason: data.stop_reason };
  };

  // Strumieniowanie (SSE) — tekst leci deltami przez ctx.onToken; tool_use składamy z fragmentów.
  const requestStream = async (): Promise<{ content: Block[]; stop_reason: string }> => {
    const res = await fetchTimeout(endpoint, { method: "POST", headers, body: JSON.stringify({ ...buildBody(), stream: true }) }, 120000);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as Resp | null;
      throw new Error(`${data?.error?.message || "Błąd API"} (${res.status})`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("stream-unsupported");
    const dec = new TextDecoder();
    const acc = new AnthStreamAccumulator();
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
    return { content: acc.content() as Block[], stop_reason: acc.stopReason || "end_turn" };
  };

  while (guard++ < 8) {
    let data: { content: Block[]; stop_reason: string };
    try {
      data = canStream ? await requestStream() : await requestFull();
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      // 400 o braku adaptacyjnego myślenia/effortu → ponów BEZ tych pól (oba tryby).
      if (richThinking && /\(400\)/.test(em) && /thinking|adaptive|effort|output_config|budget/i.test(em)) {
        richThinking = false; guard--; continue;
      }
      // Hiccup strumienia (nie sieć/timeout) → zdegraduj do pełnej odpowiedzi, by NIE zawieść tury.
      if (canStream && !/timeout|abort|failed to fetch|load failed|network/i.test(em)) {
        canStream = false; guard--; continue;
      }
      throw e;
    }

    messages.push({ role: "assistant", content: data.content });
    for (const b of data.content) {
      if ((b.type === "tool_use" || b.type === "server_tool_use") && b.name) used.add(b.name);
    }

    if (data.stop_reason === "pause_turn") continue;

    const toolUses = data.content.filter((b) => b.type === "tool_use");
    if (data.stop_reason === "tool_use" && toolUses.length) {
      const results = [];
      for (const tu of toolUses) {
        const out = await runTool(tu.name!, tu.input ?? {});
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    const text = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    // finishReason: „max_tokens" sygnalizuje UCIĘCIE (limit) — Kreator stron użyje tego do naprawy.
    return { text: text || "…", tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok }, finishReason: data.stop_reason };
  }
  return { text: "Zapętliłem się przy realizacji zadania.", tools: [...used], usage: { inputTokens: inTok, outputTokens: outTok } };
}
