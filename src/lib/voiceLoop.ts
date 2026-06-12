import { createListener, speak, stopSpeaking, isSpeechSupported, type VoiceListener } from "./voice";
import { askJarvis } from "./brain";
import { store } from "./store";
import type { Msg } from "./providers/types";

export type LoopState = "listening" | "thinking" | "speaking" | "error" | "closed";

// Rozmowa na żywo niezależna od Gemini Live: nasłuch (STT) → JARVIS (dowolny
// dostawca) → głos (TTS) → znów nasłuch. Działa wszędzie, gdzie jest STT
// (desktop/przeglądarka). Pozwala prowadzić rozmowę także bez klucza Gemini.
export class ConversationLoop {
  private listener: VoiceListener | null = null;
  private history: Msg[] = [];
  private closed = false;
  private processing = false;

  constructor(
    private onState: (s: LoopState, detail?: string) => void,
    private onCaption: (text: string) => void,
  ) {}

  static supported(): boolean {
    return isSpeechSupported();
  }

  start(): void {
    if (!ConversationLoop.supported()) {
      this.onState("error", "To urządzenie nie wspiera rozpoznawania mowy w przeglądarce. Użyj trybu Gemini Live (z kluczem Gemini).");
      return;
    }
    this.listenOnce();
  }

  private listenOnce(): void {
    if (this.closed) return;
    this.onState("listening");
    this.listener = createListener({
      wakeWord: false,
      onInterim: (t) => { if (t) this.onCaption("🗣 " + t); },
      onFinal: (t) => {
        if (this.closed || this.processing) return;
        if (t.trim()) {
          this.processing = true;
          void this.handle(t.trim());
        }
      },
      onError: (msg) => {
        if (!this.closed) this.onState("error", msg);
      },
      onEnd: () => {
        // Cisza / koniec frazy bez treści — wznawiaj nasłuch.
        if (!this.closed && !this.processing) setTimeout(() => this.listenOnce(), 300);
      },
    });
    this.listener.start();
  }

  private async handle(text: string): Promise<void> {
    this.listener?.stop();
    this.onCaption("🗣 " + text);
    this.onState("thinking");
    this.history.push({ role: "user", content: text });
    try {
      const reply = await askJarvis(this.history.slice(-12));
      this.history.push({ role: "assistant", content: reply.text });
      this.onCaption(reply.text);
      this.onState("speaking");
      await speak(reply.text, { ...store.settings, speak: true });
    } catch (e) {
      this.onState("error", e instanceof Error ? e.message : String(e));
    } finally {
      this.processing = false;
      if (!this.closed) this.listenOnce();
    }
  }

  stop(): void {
    this.closed = true;
    this.listener?.stop();
    stopSpeaking();
    this.onState("closed");
  }
}
