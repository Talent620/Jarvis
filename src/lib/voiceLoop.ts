import { createListener, speak, stopSpeaking, isSpeechSupported, type VoiceListener } from "./voice";
import { askJarvis } from "./brain";
import { store } from "./store";
import type { Msg, ProviderId } from "./providers/types";
import type { Settings } from "../types";

export type LoopState = "listening" | "thinking" | "speaking" | "error" | "closed";

// Rozmowa na żywo niezależna od Gemini Live: nasłuch (STT) → JARVIS (dowolny
// dostawca) → głos (TTS) → znów nasłuch. Działa wszędzie, gdzie jest STT
// (desktop/przeglądarka). Pozwala prowadzić rozmowę także bez klucza Gemini.
export class ConversationLoop {
  private listener: VoiceListener | null = null;
  private history: Msg[] = [];
  private closed = false;
  private processing = false;
  private wantListen = false; // czy wznawiać nasłuch (tryb głosowy); w trybie tekstowym false

  constructor(
    private onState: (s: LoopState, detail?: string) => void,
    private onCaption: (text: string) => void,
    // Dostrojenie głosu (np. „robot" w Trybie Szefa): nadpisuje pola ustawień przy TTS.
    private voiceTune?: Partial<Settings>,
    // Dodatkowa instrukcja systemowa (persona) doklejana do promptu agenta.
    private systemSuffix?: string,
    // Preferowany („najmocniejszy zmierzony") mózg — auto-router Szefa.
    private prefer?: { provider: ProviderId; model: string },
  ) {}

  static supported(): boolean {
    return isSpeechSupported();
  }

  start(): void {
    if (!ConversationLoop.supported()) {
      // Niezawodność: brak STT NIE wyłącza Szefa — zostaje tor tekstowy (say()).
      this.onState("error", "Mowa niedostępna na tym urządzeniu — wpisz polecenie poniżej (Szef i tak wykona).");
      return;
    }
    this.wantListen = true;
    this.listenOnce();
  }

  /** Tor tekstowy (fallback): wpisane polecenie idzie tą samą drogą co usłyszane. */
  say(text: string): void {
    const t = (text || "").trim();
    if (this.closed || this.processing || !t) return;
    this.processing = true;
    this.listener?.stop();
    void this.handle(t);
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
      const reply = await askJarvis(this.history.slice(-12), undefined, undefined, this.systemSuffix, this.prefer);
      this.history.push({ role: "assistant", content: reply.text });
      this.onCaption(reply.text);
      this.onState("speaking");
      await speak(reply.text, { ...store.settings, speak: true, ...this.voiceTune });
    } catch (e) {
      this.history.pop(); // zdejmij nieodpowiedzianą wiadomość użytkownika — historia musi zostać sparowana
      this.onState("error", e instanceof Error ? e.message : String(e));
    } finally {
      this.processing = false;
      // Wznów nasłuch tylko w trybie głosowym; w trybie tekstowym czekamy na kolejne say().
      if (!this.closed && this.wantListen) this.listenOnce();
    }
  }

  stop(): void {
    this.closed = true;
    this.listener?.stop();
    stopSpeaking();
    this.onState("closed");
  }
}
