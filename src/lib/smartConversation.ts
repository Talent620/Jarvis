import { createRecognition, usesRecordedStt, isNativeApp } from "./voice";
import { WhisperListener } from "./whisperListener";
import { primaryKey } from "./keys";
import { VoiceCapture } from "./voiceCapture";
import { matchScore } from "./voiceprint";
import { shouldFinalize, type EndpointConfig } from "./endpoint";

// === Silnik naturalnej rozmowy (flagowy) ===
// Łączy trzy rzeczy, których brakuje zwykłym asystentom:
//  1) SEMANTYCZNY ENDPOINTING — nie ucina Cię, gdy zamilkniesz, by pomyśleć;
//     czeka, aż zdanie naprawdę się domknie (endpoint.ts).
//  2) ODCISK GŁOSU — reaguje tylko na Twój głos, odsiewa innych ludzi/TV
//     (voiceprint.ts + voiceCapture.ts), gdy włączysz blokadę głosu.
//  3) BARGE-IN — gdy zaczynasz mówić w trakcie odpowiedzi, natychmiast milknie.
// Rozpoznawanie słów: Web Speech (ciągłe) w przeglądarce; na desktopie i natywnym
// Androidzie/iOS (z kluczem Groq) — tor nagrywany Whisper (WhisperListener), bo Web
// Speech w tych WebView nie transkrybuje. Analiza głosu: równoległy strumień audio.
// Gdy równoległego strumienia nie da się otworzyć — degraduje do samego endpointingu.

export type SmartState = "idle" | "listening" | "capturing" | "thinking" | "speaking" | "error";

export interface SmartConfig {
  voiceLock: boolean;
  profile: number[];
  matchThreshold: number;
  endpoint: EndpointConfig;
  wakeWord: boolean;
  lang?: string;
}

export interface SmartHandlers {
  onState: (s: SmartState, detail?: string) => void;
  onPartial: (text: string) => void;
  onUtterance: (text: string) => void;
  onLevel?: (lvl: number) => void;
  onRejected?: (reason: "speaker") => void;
  onBargeIn?: () => void;
  onInfo?: (msg: string) => void;
}

const WAKE_RE = /d[zż]+[ae]rwis|jarvis|dżarwis/i;

export class SmartConversation {
  private rec = createRecognition();
  private cap = new VoiceCapture();
  private capOn = false;
  private closed = false;
  private speakingTts = false; // czy JARVIS właśnie mówi (dla barge-in)
  private armed: boolean;
  private finalText = "";
  private interimText = "";
  private lastWordAt = 0;
  private tickTimer: number | null = null;
  private restartTimer: number | null = null;
  private whisper: WhisperListener | null = null; // tor nagrywany (desktop/Android)
  private gotResult = false; // czy Web Speech kiedykolwiek coś usłyszał (watchdog)
  private watchdog: number | null = null;

  constructor(private cfg: SmartConfig, private h: SmartHandlers) {
    this.armed = !cfg.wakeWord;
  }

  async start(): Promise<void> {
    if (this.tickTimer || this.whisper) return; // już wystartowane — bez podwójnego mikrofonu
    this.closed = false;

    // Tor nagrywany (Whisper/Groq) — desktop oraz natywny Android/iOS z kluczem Groq.
    // Web Speech w tych WebView nie transkrybuje, więc tu jest jedyna pewna ścieżka.
    if (usesRecordedStt()) { this.startRecorded(); return; }

    // Równoległy strumień audio (VAD + mówca + barge-in). Best-effort.
    this.capOn = await this.cap.start({
      onLevel: (l) => this.h.onLevel?.(l),
      onActivity: (sp) => { if (sp) this.onUserVoice(); },
    });
    if (this.cfg.voiceLock && !this.capOn) {
      this.h.onInfo?.("Blokada głosu niedostępna na tym urządzeniu — słucham normalnie.");
    }
    this.startRecognition();
    this.h.onState(this.armed ? "listening" : "idle"); // idle = czekam na słowo „Jarvis"
    this.tickTimer = window.setInterval(() => this.tick(), 140);

    // Watchdog: na natywnym (APK) bez klucza Groq Web Speech bywa martwe i nasłuch
    // wisi w nieskończoność. Jeśli po 7 s nic nie usłyszeliśmy — powiedz, jak to naprawić.
    if (isNativeApp() && !primaryKey("groq")) {
      this.watchdog = window.setTimeout(() => {
        if (!this.closed && !this.gotResult) {
          this.h.onInfo?.("Nie słyszę nic — na tym telefonie rozpoznawanie mowy działa pewnie dopiero z kluczem Groq (darmowy): ⚙ → AI.");
        }
      }, 7000);
    }
  }

  // Tor nagrywany: WhisperListener robi VAD + endpointing + słowo „Jarvis"; my tylko
  // przekazujemy gotowe wypowiedzi dalej. Wyciszanie własnego TTS jest w środku (isSpeaking()).
  private startRecorded(): void {
    if (this.cfg.voiceLock) {
      this.h.onInfo?.("Blokada głosu działa w trybie Web Speech — tutaj słucham normalnie.");
    }
    this.whisper = new WhisperListener({
      wakeWord: this.cfg.wakeWord,
      continuous: true, // hands-free: po wypowiedzi słuchaj dalej
      onWake: () => { if (!this.closed) this.h.onState("capturing"); },
      onInterim: (t) => { if (!this.closed && t) this.h.onPartial(t); },
      onFinal: (t) => { if (this.closed) return; this.gotResult = true; this.h.onState("thinking"); this.h.onUtterance(t); },
      onError: (m) => this.h.onInfo?.(m),
      onEnd: () => { /* w trybie ciągłym nie kończymy z własnej woli */ },
    });
    this.h.onState(this.armed ? "listening" : "idle");
    this.whisper.start(this.cfg.lang || "pl-PL");
  }

  /** Poinformuj silnik, że JARVIS mówi (włącza wykrywanie barge-in). */
  setSpeaking(on: boolean): void {
    this.speakingTts = on;
  }

  private startRecognition(): void {
    if (!this.rec || this.closed) return;
    this.rec.lang = this.cfg.lang || "pl-PL";
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.onresult = (e: any) => {
      let interim = "";
      let finalAdd = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalAdd += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.gotResult = true; // Web Speech żyje — watchdog się nie odpali
      if (finalAdd) this.finalText += (this.finalText ? " " : "") + finalAdd.trim();
      this.interimText = interim;
      this.lastWordAt = Date.now();
      this.handleText();
    };
    this.rec.onerror = () => { /* restart przez onend */ };
    this.rec.onend = () => {
      if (this.closed) return;
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = window.setTimeout(() => { try { this.rec?.start(); } catch { /* ignore */ } }, 200);
    };
    try { this.rec.start(); } catch { /* już działa */ }
  }

  private rawPartial(): string {
    return `${this.finalText} ${this.interimText}`.trim();
  }

  // Wypowiedź właściwego mówcy aktywuje barge-in (przerwanie odpowiedzi).
  private onUserVoice(): void {
    if (!this.speakingTts) return;
    if (this.cfg.voiceLock && this.capOn) {
      const score = matchScore(this.cfg.profile, this.cap.recentEmbedding());
      if (score < this.cfg.matchThreshold) return; // nie Ty / tło — nie przerywaj
    }
    this.h.onBargeIn?.();
  }

  private handleText(): void {
    let text = this.rawPartial();
    // Bramka słowa „Jarvis" (gdy wymagana): uzbrój turę i odetnij słowo-klucz.
    if (this.cfg.wakeWord && !this.armed) {
      if (WAKE_RE.test(text)) {
        this.armed = true;
        this.finalText = this.finalText.replace(WAKE_RE, "").trim();
        text = this.rawPartial();
        this.h.onState("capturing");
      } else {
        return; // czekamy na „Jarvis"
      }
    }
    if (text) this.h.onPartial(text);
  }

  private tick(): void {
    if (this.closed || !this.armed) return;
    const text = this.finalText.trim(); // do decyzji bierzemy ustabilizowaną część
    const silence = Date.now() - this.lastWordAt;
    if (!text) return;
    if (shouldFinalize(text, silence, this.cfg.endpoint)) this.finalize();
  }

  private finalize(): void {
    const text = (this.finalText + " " + this.interimText).trim();
    this.finalText = "";
    this.interimText = "";
    if (this.cfg.wakeWord) this.armed = false; // wróć do nasłuchu słowa-klucza
    if (!text) return;

    // Blokada głosu: odsiej, jeśli to nie Twój głos.
    if (this.cfg.voiceLock && this.capOn) {
      const score = matchScore(this.cfg.profile, this.cap.recentEmbedding());
      this.cap.resetUtterance();
      if (score < this.cfg.matchThreshold) {
        this.h.onRejected?.("speaker");
        return;
      }
    } else {
      this.cap.resetUtterance();
    }
    this.h.onUtterance(text);
  }

  stop(): void {
    this.closed = true;
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null; }
    if (this.whisper) { try { this.whisper.stop(); } catch { /* ignore */ } this.whisper = null; }
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.cap.stop();
  }
}
