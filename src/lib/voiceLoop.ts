import { createListener, speak, stopSpeaking, isSpeechSupported, type VoiceListener } from "./voice";
import { askJarvis } from "./brain";
import { store } from "./store";
import { needsVerification, verifyAndCorrect } from "./selfVerify";
import { detectDecision } from "./decisions";
import { recordBossDecision } from "./bossMemory";
import { confidencePct, confidencePreface, isRiskyCommand, isExplainRequest, explainTrace, predictNext, type BossTrace, type VerifyResult } from "./bossInsight";
import { providerShortName } from "./providerNames";
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
    // Opcje Szefa: weryfikacja, pamięć decyzji, watchdog czasu oraz „insight"
    // (skalibrowana pewność + czarna skrzynka + predykcyjny krok dalej).
    private opts: { verify?: boolean; captureDecisions?: boolean; stallMs?: number; insight?: boolean } = {},
  ) {}

  private lastTrace: BossTrace | null = null; // czarna skrzynka ostatniego działania

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
    // 🕶 Czarna skrzynka: „dlaczego/jak to zrobiłeś?" → wyjaśnij ostatnie działanie bez modelu.
    if (this.opts.insight && isExplainRequest(text) && this.lastTrace) {
      const e = explainTrace(this.lastTrace);
      this.onState("speaking");
      this.onCaption(e);
      try { await speak(e, { ...store.settings, speak: true, ...this.voiceTune }); } catch { /* brak głosu */ }
      this.processing = false;
      if (!this.closed && this.wantListen) this.listenOnce();
      return;
    }
    this.onState("thinking");
    this.history.push({ role: "user", content: text });
    // Pamięć decyzji: jeśli padło ustalenie/zobowiązanie — zapamiętaj na przyszłe sesje.
    if (this.opts.captureDecisions) {
      const d = detectDecision(text);
      if (d) recordBossDecision(d.due ? `${d.statement} (termin: ${d.due})` : d.statement);
    }
    // Watchdog czasu: gdy myślenie się przeciąga, Szef zapewnia, że pracuje (nie znika w ciszy).
    let stalled = false;
    const stall = window.setTimeout(() => {
      if (this.closed) return;
      stalled = true;
      const m = "Pracuję nad tym dłużej niż zwykle — już wracam z wynikiem.";
      this.onCaption("⏳ " + m);
      void speak(m, { ...store.settings, speak: true, ...this.voiceTune }).catch(() => {});
    }, this.opts.stallMs && this.opts.stallMs > 0 ? this.opts.stallMs : 9000);
    const t0 = Date.now();
    try {
      let reply = await askJarvis(this.history.slice(-12), undefined, undefined, this.systemSuffix, this.prefer);
      // Samoweryfikacja + eskalacja: trudne zadanie sprawdza drugi, mocniejszy przebieg.
      let verify: VerifyResult = "none";
      if (this.opts.verify && needsVerification(text)) {
        this.onCaption("🔎 Sprawdzam wynik…");
        const v = await verifyAndCorrect(text, reply.text);
        verify = v.corrected ? "fixed" : "pass";
        if (v.corrected) reply = { ...reply, text: v.text };
      }
      window.clearTimeout(stall);
      this.history.push({ role: "assistant", content: reply.text });

      // 🧭 Insight: skalibrowana pewność (mówiona, gdy istotna), predykcja kroku dalej, ślad do czarnej skrzynki.
      let spoken = reply.text;
      if (this.opts.insight) {
        const conf = confidencePct(reply.text, verify);
        const caution = confidencePreface(conf, isRiskyCommand(text));
        const next = predictNext(text);
        this.lastTrace = {
          brain: providerShortName(reply.via || this.prefer?.provider || "auto"),
          verify, conf, ms: Date.now() - t0, tools: reply.tools || [],
        };
        spoken = [caution, reply.text, next ? `Mogę też: ${next}. Powiedz „tak”.` : ""].filter(Boolean).join(" ");
      }

      this.onCaption(spoken);
      this.onState("speaking");
      if (stalled) stopSpeaking(); // ucisz „jeszcze pracuję", zanim podasz wynik
      await speak(spoken, { ...store.settings, speak: true, ...this.voiceTune });
    } catch (e) {
      window.clearTimeout(stall);
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
