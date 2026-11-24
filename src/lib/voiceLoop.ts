import { createListener, speak, stopSpeaking, isSpeechSupported, type VoiceListener } from "./voice";
import { BargeInController } from "./modalVoice";
import { askJarvis } from "./brain";
import { store } from "./store";
import { needsVerification, verifyAndCorrect } from "./selfVerify";
import { detectDecision } from "./decisions";
import { recordBossDecision } from "./bossMemory";
import { confidencePct, confidencePreface, isRiskyCommand, isExplainRequest, explainTrace, predictNext, type BossTrace, type VerifyResult } from "./bossInsight";
import { providerShortName } from "./providerNames";
import { fallbackNotice, fallbackVoiceLine, shouldAnnounceFallback } from "./providers/registry";
import { isDesktop } from "./desktop";
import { abortOmniPilot, executeOmniVoiceCommand } from "./omniPilot";
import { stopOmniSentinel } from "./omniSentinel";
import { stopAllGoals } from "./goalControl";
import { toast } from "./toast";
import { parseBossMeta } from "./boss";
import { formatForSpokenPolish } from "./soulModes";
import { recordCorrectionLesson } from "./sleepCompute";
import { handleVoiceOrChatGoalCommand, shortenForVoice } from "./goalVoiceBridge";
import type { Msg, ProviderId } from "./providers/types";
import type { Settings } from "../types";

export type LoopState = "listening" | "thinking" | "speaking" | "error" | "closed";

// Rozmowa na żywo niezależna od Gemini Live: nasłuch (STT) → JARVIS (dowolny
// dostawca) → głos (TTS) → znów nasłuch, z obsługą barge-in (przerywania wypowiedzi).
export class ConversationLoop {
  private listener: VoiceListener | null = null;
  private history: Msg[] = [];
  private closed = false;
  private processing = false;
  private wantListen = false; // czy wznawiać nasłuch (tryb głosowy); w trybie tekstowym false
  private readonly bargeIn = new BargeInController({
    onInterrupt: () => {
      stopSpeaking();
      try { recordCorrectionLesson("", true); } catch { /* best-effort */ }
      if (!this.closed) {
        this.onCaption("✋ Przerwano — słucham…");
        this.onState("listening");
      }
    },
  });

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
  private lastReply = ""; // ostatnia wypowiedź Szefa — do meta-rozkazu „powtórz"
  // Zapasowy dostawca z poprzedniej odpowiedzi (null = poprzednio bez failoveru) — żeby ogłaszać
  // przełączenie przy ZMIANIE stanu, a nie przerywać każdej kolejnej odpowiedzi tego samego zapasu.
  private lastFallbackVia: ProviderId | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  static supported(): boolean {
    return isSpeechSupported();
  }

  /** Wstrzyknij wcześniejszą historię (ciągłość rozmowy po ponownym otwarciu). */
  seedHistory(msgs: Msg[]): void {
    if (Array.isArray(msgs) && msgs.length) this.history = msgs.slice(-12);
  }

  /** Bieżąca historia rozmowy (do zapisania ciągłości). */
  getHistory(): Msg[] {
    return this.history.slice();
  }

  /** Wyczyść historię (nowy temat). */
  resetHistory(): void {
    this.history = [];
    this.lastReply = "";
  }

  /** Zmień profil głosu na żywo (np. przełączenie Kapitan Bomba ⇄ Robot). */
  setVoiceTune(v: Partial<Settings>): void {
    this.voiceTune = v;
  }

  /** Natychmiastowy synchroniczny Kill-Switch: przerywa OMNI-PILOT, Sentinela, cele i TTS. */
  private triggerKillSwitch(): void {
    abortOmniPilot();
    stopOmniSentinel("Przerwano komendą głosową STOP.");
    stopAllGoals();
    stopSpeaking();
    if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
    this.onCaption("⏹ Zatrzymano wszystko (OMNI-PILOT / Strażnik / Cele). Słucham dalej.");
    this.onState("listening");
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
    if (this.closed || !t) return;
    // Kill-Switch działa NATYCHMIAST nawet podczas aktywnego wykonywania polecenia!
    if (parseBossMeta(t) === "stop") {
      this.triggerKillSwitch();
      this.processing = false;
      return;
    }
    if (this.processing) return;
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
        if (this.closed) return;
        const clean = t.trim();
        if (!clean) return;
        if (parseBossMeta(clean) === "stop") {
          this.triggerKillSwitch();
          this.processing = false;
          if (!this.closed && this.wantListen) this.listenOnce();
          return;
        }
        if (this.processing) return;
        this.processing = true;
        void this.handle(clean);
      },
      onError: (msg) => {
        if (!this.closed) this.onState("error", msg);
      },
      onEnd: () => {
        // Cisza / koniec frazy bez treści — wznawiaj nasłuch (z czystym uchwytem timera).
        if (!this.closed && !this.processing) {
          if (this.restartTimer) clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.listenOnce();
          }, 300);
        }
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
    // ⚡ META-rozkazy bez modelu (natychmiast, pewnie): stop/stój/przerwij/anuluj, powtórz.
    const meta = parseBossMeta(text);
    if (meta === "stop") {
      this.triggerKillSwitch();
      this.processing = false;
      if (!this.closed && this.wantListen) this.listenOnce();
      return;
    }
    if (meta === "repeat") {
      const r = this.lastReply.trim() || "Nie mam jeszcze nic do powtórzenia.";
      this.onState("speaking");
      this.onCaption(r);
      try { await speak(r, { ...store.settings, speak: true, ...this.voiceTune }); } catch { /* brak głosu */ }
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
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (this.closed) return;
      stalled = true;
      const m = "Pracuję nad tym dłużej niż zwykle — już wracam z wynikiem.";
      this.onCaption("⏳ " + m);
      void speak(m, { ...store.settings, speak: true, ...this.voiceTune }).catch(() => {});
    }, this.opts.stallMs && this.opts.stallMs > 0 ? this.opts.stallMs : 9000);
    const t0 = Date.now();
    try {
      // OMNI-PILOT (desktop Linux/Windows): pełne sterowanie kursorem, wizją i oknami również w BossMode / LiveOverlay.
      if (isDesktop()) {
        const omni = await executeOmniVoiceCommand(text);
        if (omni.handled) {
          if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
          const outText = omni.text || "Gotowe.";
          const spoken = omni.spokenText || outText;
          this.history.push({ role: "assistant", content: outText });
          this.lastReply = spoken;
          this.onCaption(outText);
          this.onState("speaking");
          if (stalled) stopSpeaking();
          this.bargeIn.beginSpeaking();
          try {
            await speak(spoken, { ...store.settings, speak: true, ...this.voiceTune });
          } finally {
            this.bargeIn.endSpeaking();
          }
          return;
        }
      }
      // Trwałe cele wieloetapowe (voiceCognition → agentPlanner → goalRuntime) w pętli głosowej.
      const goalCmd = await handleVoiceOrChatGoalCommand(text);
      if (goalCmd.handled) {
        if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
        const outText = goalCmd.text || "Gotowe.";
        const spoken = goalCmd.spokenText || shortenForVoice(outText);
        this.history.push({ role: "assistant", content: outText });
        this.lastReply = spoken;
        this.onCaption(outText);
        this.onState("speaking");
        if (stalled) stopSpeaking();
        this.bargeIn.beginSpeaking();
        try {
          await speak(spoken, { ...store.settings, speak: true, ...this.voiceTune });
        } finally {
          this.bargeIn.endSpeaking();
        }
        return;
      }
      let reply = await askJarvis(
        this.history.slice(-12),
        undefined,
        undefined,
        this.systemSuffix,
        this.prefer,
        { voiceMode: true },
      );
      // Samoweryfikacja + eskalacja: trudne zadanie sprawdza drugi, mocniejszy przebieg.
      let verify: VerifyResult = "none";
      if (this.opts.verify && needsVerification(text)) {
        this.onCaption("🔎 Sprawdzam wynik…");
        const v = await verifyAndCorrect(text, reply.text);
        verify = v.corrected ? "fixed" : "pass";
        if (v.corrected) reply = { ...reply, text: v.text };
      }
      if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
      this.history.push({ role: "assistant", content: reply.text });
      // Failover widoczny tak jak w czacie tekstowym: BossMode i LiveOverlay (silnik „loop")
      // dzielą tę pętlę, więc jedna poprawka ujawnia zapasowy mózg w obu miejscach.
      // Ogłaszamy przy ZMIANIE stanu (wejście w failover / zmiana zapasu): toast + jedna krótka
      // linia mówiona (użytkownik bez ekranu też musi to zauważyć) — bez przerywania każdej tury.
      const announceFallback = shouldAnnounceFallback(this.lastFallbackVia, reply);
      this.lastFallbackVia = reply.fellBack && reply.via ? reply.via : null;
      const notice = fallbackNotice(reply);
      if (notice && announceFallback) toast(notice);

      // 🧭 Insight: skalibrowana pewność (mówiona, gdy istotna), predykcja kroku dalej, ślad do czarnej skrzynki.
      const baseSpoken = formatForSpokenPolish(reply.text, 3) || reply.text;
      let spoken = baseSpoken.length > 360 ? shortenForVoice(baseSpoken, 360) : baseSpoken;
      if (this.opts.insight) {
        const conf = confidencePct(reply.text, verify);
        const caution = confidencePreface(conf, isRiskyCommand(text));
        const next = predictNext(text);
        this.lastTrace = {
          brain: providerShortName(reply.via || this.prefer?.provider || "auto"),
          verify, conf, ms: Date.now() - t0, tools: reply.tools || [],
        };
        spoken = [caution, spoken, next ? `Mogę też: ${next}. Powiedz „tak”.` : ""].filter(Boolean).join(" ");
      }

      this.lastReply = spoken; // zapamiętaj do meta-rozkazu „powtórz"
      // Jedno krótkie zdanie mówione przy WEJŚCIU w failover (nie przy każdej turze na zapasie)
      // — celowo po zapisie lastReply, żeby „powtórz" nie powtarzał przerywnika.
      const voiceLine = announceFallback ? fallbackVoiceLine(reply) : null;
      if (voiceLine) spoken = `${voiceLine} ${spoken}`;
      this.onCaption(spoken);
      this.onState("speaking");
      if (stalled) stopSpeaking(); // ucisz „jeszcze pracuję”, zanim podasz wynik
      this.bargeIn.beginSpeaking();
      try {
        await speak(spoken, { ...store.settings, speak: true, ...this.voiceTune });
      } finally {
        this.bargeIn.endSpeaking();
      }
    } catch (e) {
      if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
      this.history.pop(); // zdejmij nieodpowiedzianą wiadomość użytkownika — historia musi zostać sparowana
      this.onState("error", e instanceof Error ? e.message : String(e));
    } finally {
      this.processing = false;
      // Wznów nasłuch tylko w trybie głosowym; w trybie tekstowym czekamy na kolejne say().
      if (!this.closed && this.wantListen) this.listenOnce();
    }
  }

  /** Full-duplex barge-in: przekaż próbkę energii mikrofonu (RMS 0..1) podczas mówienia JARVIS-a. */
  feedMicLevel(rms: number): boolean {
    return this.bargeIn.feedMicLevel(rms);
  }

  /** Natychmiast przerwij wypowiedź JARVIS-a (barge-in) i wróć do nasłuchu. */
  interrupt(): void {
    this.bargeIn.interrupt();
  }

  stop(): void {
    this.closed = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null; }
    this.bargeIn.endSpeaking();
    this.listener?.stop();
    stopSpeaking();
    this.onState("closed");
  }
}
