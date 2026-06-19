import type { ListenCallbacks, VoiceListener } from "./voice";
import { isSpeaking } from "./voice";
import { transcribeAudio } from "./transcribe";
import { primaryKey } from "./keys";
import { setLevel } from "./audioLevel";
import { micAudioConstraints } from "./mic";

// Rozpoznawanie mowy dla DESKTOPA (Electron / Windows .exe). W Electronie wbudowane
// Web Speech (webkitSpeechRecognition) nie działa — Chromium nie ma dostępu do serwerów
// mowy Google'a, więc mikrofon zapala się i gaśnie. Tu nagrywamy głos, wykrywamy ciszę
// (koniec zdania) i transkrybujemy przez Groq Whisper (darmowy). Działa bez Google'a.
//
// Detekcja głosu (VAD) bramkuje nagrywanie: w ciszy NIC nie wysyłamy, więc nasłuch
// (także tryb słowa „Jarvis") nie zużywa limitu — koszt powstaje tylko, gdy mówisz.

const WAKE_RE = /d[zż]+[ae]rwis|jarvis|dżarwis/i;
const FRAME_MS = 50;
const SILENCE_MS = 850; // tyle ciszy = koniec wypowiedzi
const MIN_SPEECH_MS = 350; // krótsze „wypowiedzi" to stuki/szum — pomijamy
const MAX_UTTERANCE_MS = 15000; // bezpiecznik długości nagrania

function pickMime(): string {
  const MR = (window as any).MediaRecorder;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) {
    try { if (MR?.isTypeSupported?.(m)) return m; } catch { /* ignore */ }
  }
  return "";
}

export class WhisperListener implements VoiceListener {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private td: Float32Array = new Float32Array(0);
  private timer: number | null = null;

  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = "";
  private recording = false;
  private busy = false; // trwa transkrypcja — nie zaczynamy nowego segmentu
  private speechMs = 0;
  private silenceMs = 0;
  private utteranceMs = 0;
  private noiseFloor = 0.0015;

  private active = false;
  private armed: boolean;
  private lang = "pl";

  constructor(private cb: ListenCallbacks) {
    this.armed = !cb.wakeWord;
  }

  get listening(): boolean {
    return this.active;
  }

  start(lang = "pl-PL"): void {
    if (this.active) return;
    this.lang = lang.slice(0, 2) || "pl";
    if (!primaryKey("groq")) {
      this.cb.onError?.("Rozpoznawanie mowy na komputerze używa Groq (darmowy) — dodaj klucz Groq w ⚙ → AI.");
      this.cb.onEnd?.();
      return;
    }
    this.mime = pickMime();
    void this.boot();
  }

  private async boot(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: micAudioConstraints({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }),
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      this.cb.onError?.(
        name === "NotAllowedError"
          ? "Brak zgody na mikrofon — zezwól na mikrofon w ustawieniach urządzenia/przeglądarki."
          : name === "NotReadableError"
            ? "Mikrofon jest zajęty przez inną aplikację — zamknij ją i spróbuj ponownie."
            : name === "NotFoundError"
              ? "Nie znaleziono mikrofonu na tym urządzeniu."
              : "Brak dostępu do mikrofonu — sprawdź uprawnienia do mikrofonu.",
      );
      this.cb.onEnd?.();
      return;
    }
    this.active = true;
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.td = new Float32Array(this.analyser.fftSize);
    this.timer = window.setInterval(() => this.tick(), FRAME_MS);
  }

  private tick(): void {
    const a = this.analyser;
    if (!a || !this.active) return;
    a.getFloatTimeDomainData(this.td as any);
    let sum = 0;
    for (let i = 0; i < this.td.length; i++) sum += this.td[i] * this.td[i];
    const rms = this.td.length ? Math.sqrt(sum / this.td.length) : 0;
    setLevel(Math.min(1, rms * 12)); // orb pulsuje poziomem (Whisper nie daje tekstu „na żywo")

    // Wyciszenie na czas mówienia JARVIS-a: nie nasłuchujemy własnego głosu (echo/samowyzwalanie).
    // Jeśli akurat trwało nagranie, domknij je (wynik dojdzie), ale nie zaczynaj nowego.
    if (isSpeaking()) {
      if (this.recording) { this.silenceMs += FRAME_MS; if (this.silenceMs >= SILENCE_MS) this.endSegment(); }
      return;
    }

    const threshold = Math.max(0.006, this.noiseFloor * 2.4);
    const voiced = rms > threshold;

    if (this.busy) return; // czekamy na wynik transkrypcji — nie nagrywamy nowego

    if (voiced) {
      if (!this.recording) this.beginSegment();
      this.speechMs += FRAME_MS;
      this.silenceMs = 0;
    } else {
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
      if (this.recording) this.silenceMs += FRAME_MS;
    }

    if (this.recording) {
      this.utteranceMs += FRAME_MS;
      const done = this.silenceMs >= SILENCE_MS || this.utteranceMs >= MAX_UTTERANCE_MS;
      if (done) this.endSegment();
    }
  }

  private beginSegment(): void {
    if (!this.stream) return;
    this.chunks = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    this.utteranceMs = 0;
    try {
      this.rec = this.mime ? new MediaRecorder(this.stream, { mimeType: this.mime }) : new MediaRecorder(this.stream);
    } catch {
      this.rec = new MediaRecorder(this.stream);
    }
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => this.onSegmentReady();
    try { this.rec.start(); this.recording = true; } catch { this.recording = false; }
  }

  private endSegment(): void {
    this.recording = false;
    this.busy = true; // wstrzymaj nowe nagrania do czasu wyniku
    try { this.rec?.stop(); } catch { this.busy = false; }
  }

  private async onSegmentReady(): Promise<void> {
    const speechMs = this.speechMs;
    const blob = new Blob(this.chunks, { type: this.mime || "audio/webm" });
    this.chunks = [];
    // Za krótkie / puste = szum, nie wysyłamy do Whisper (oszczędzamy limit).
    if (speechMs < MIN_SPEECH_MS || blob.size < 1200) { this.busy = false; return; }

    const r = await transcribeAudio(blob, this.lang);
    this.busy = false;
    if (!this.active) return;
    if ("error" in r) { this.cb.onError?.(r.error); return; }
    const clean = (r.text || "").trim();
    if (!clean) return;
    this.handleTranscript(clean);
  }

  private handleTranscript(text: string): void {
    if (!this.armed) {
      // Tryb słowa „Jarvis": czekamy, aż padnie — wtedy bierzemy resztę jako komendę.
      if (WAKE_RE.test(text)) {
        this.armed = true;
        this.cb.onWake?.();
        const rest = text.replace(/^.*?(jarvis|dżarwis|d[zż]+[ae]rwis)[\s,:.!-]*/i, "").trim();
        if (rest) {
          this.cb.onFinal(rest);
          if (this.cb.wakeWord) this.armed = false;
        }
      }
      return;
    }
    const command = text.replace(/^.*?(jarvis|dżarwis)[\s,:.!-]*/i, "").trim() || text;
    this.cb.onFinal(command);
    if (this.cb.wakeWord) {
      this.armed = false; // wróć do nasłuchu słowa-klucza
    } else {
      // Pojedyncza wypowiedź — kończymy nasłuch (jak Web Speech bez wakeWord).
      this.stop();
      this.cb.onEnd?.();
    }
  }

  stop(): void {
    if (!this.active && !this.timer) return;
    this.active = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { if (this.recording) this.rec?.stop(); } catch { /* ignore */ }
    this.recording = false;
    this.busy = false;
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null; this.analyser = null; this.stream = null;
    setLevel(0);
  }
}
