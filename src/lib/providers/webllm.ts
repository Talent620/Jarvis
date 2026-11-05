import { throwIfAborted } from "../abort";
import type { AskCtx, JarvisReply } from "./types";
import { chatLocal, WEBLLM_DEFAULT_MODEL, type ChatMsg } from "../webllm";

// Provider mózgu on-device (WebLLM/MLC). Zgodny z ProviderImpl. API WebLLM jest
// OpenAI-compatible (system/history → messages). UWAGA: małe modele lokalne nie prowadzą
// pętli narzędzi — zwracamy czystą odpowiedź tekstową (narzędzia obsługują adaptery chmurowe).
export async function askWebllm(ctx: AskCtx): Promise<JarvisReply> {
  throwIfAborted(ctx.signal);
  if (ctx.requiresTools) throw new Error("Ten adapter WebLLM nie wykonuje narzędzi wymaganych przez polecenie. Nie wykonano działania.");
  if (ctx.history.some(message => !!message.image)) throw new Error("Ten adapter WebLLM nie obsługuje obrazu. Nie przeprowadzono analizy ekranu.");
  const messages: ChatMsg[] = [];
  if (ctx.system?.trim()) messages.push({ role: "system", content: ctx.system });
  for (const m of ctx.history) {
    // Modele tekstowe nie przyjmują obrazów — dołączamy tylko tekst (wizja idzie do chmury).
    messages.push({ role: m.role, content: m.content });
  }
  const text = await chatLocal(ctx.model || WEBLLM_DEFAULT_MODEL, messages, { temperature: ctx.fast ? 0.5 : 0.7 });
  throwIfAborted(ctx.signal);
  if (text == null) {
    throw new Error(
      "Model on-device (WebLLM) niedostępny — wymaga przeglądarki z WebGPU. Włącz go w ⚙ → AI albo użyj modelu w chmurze.",
    );
  }
  return { text: text.trim(), tools: [], via: "webllm" };
}
