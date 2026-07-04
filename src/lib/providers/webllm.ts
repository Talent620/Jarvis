import type { AskCtx, JarvisReply } from "./types";
import { chatLocal, WEBLLM_DEFAULT_MODEL, type ChatMsg } from "../webllm";

// Provider mózgu on-device (WebLLM/MLC). Zgodny z ProviderImpl. API WebLLM jest
// OpenAI-compatible (system/history → messages). UWAGA: małe modele lokalne nie prowadzą
// pętli narzędzi — zwracamy czystą odpowiedź tekstową (narzędzia obsługują adaptery chmurowe).
export async function askWebllm(ctx: AskCtx): Promise<JarvisReply> {
  const messages: ChatMsg[] = [];
  if (ctx.system?.trim()) messages.push({ role: "system", content: ctx.system });
  for (const m of ctx.history) {
    // Modele tekstowe nie przyjmują obrazów — dołączamy tylko tekst (wizja idzie do chmury).
    messages.push({ role: m.role, content: m.content });
  }
  const text = await chatLocal(ctx.model || WEBLLM_DEFAULT_MODEL, messages, { temperature: ctx.fast ? 0.5 : 0.7 });
  if (text == null) {
    throw new Error(
      "Model on-device (WebLLM) niedostępny — wymaga przeglądarki z WebGPU. Włącz go w ⚙ → AI albo użyj modelu w chmurze.",
    );
  }
  return { text: text.trim(), tools: [], via: "webllm" };
}
