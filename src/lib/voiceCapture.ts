import { melBands, embed } from "./voiceprint";

// Przechwytywanie audio z mikrofonu RÓWNOLEGLE do rozpoznawania mowy: liczy
// energię (VAD z adaptacyjnym progiem tła — odporność na muzykę/szum) oraz cechy
// widmowe mówcy (do „reaguj tylko na mój głos"). Daje też poziom do animacji orba
// i sygnał aktywności głosu do barge-in (przerwania, gdy zaczynasz mówić).

export interface CaptureHandlers {
  onLevel?: (level: number) => void;
  onActivity?: (speaking: boolean) => void;
}

const FRAME_MS = 30;
const BUFFER_FRAMES = 220; // ~6.5 s historii cech (na embedding wypowiedzi)

export class VoiceCapture {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private timer: number | null = null;
  private td: Float32Array = new Float32Array(0);
  private fd: Float32Array = new Float32Array(0);

  private noiseFloor = 0.0015; // adaptacyjny próg tła (RMS)
  private speaking = false;
  private silenceFrames = 0;
  private frames: number[][] = []; // cechy mel bieżącej wypowiedzi
  private h: CaptureHandlers = {};

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Embedding mówcy z bieżąco zebranych ramek (do dopasowania do profilu). */
  recentEmbedding(): number[] {
    return embed(this.frames);
  }
  resetUtterance(): void {
    this.frames = [];
  }

  async start(h: CaptureHandlers): Promise<boolean> {
    this.h = h;
    try {
      // Bez agresywnego tłumienia, by nie psuć cech głosu, ale z redukcją echa.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.4;
      src.connect(this.analyser);
      this.td = new Float32Array(this.analyser.fftSize);
      this.fd = new Float32Array(this.analyser.frequencyBinCount);
      this.timer = window.setInterval(() => this.tick(), FRAME_MS);
      return true;
    } catch {
      this.stop();
      return false; // brak zgody na mikrofon lub konflikt z rozpoznawaniem mowy
    }
  }

  private tick(): void {
    const a = this.analyser;
    if (!a || !this.ctx) return;
    a.getFloatTimeDomainData(this.td as any);
    let sum = 0;
    for (let i = 0; i < this.td.length; i++) sum += this.td[i] * this.td[i];
    const rms = this.td.length ? Math.sqrt(sum / this.td.length) : 0;

    // Próg = tło × współczynnik (i minimum). Tło aktualizujemy tylko w ciszy.
    const threshold = Math.max(0.006, this.noiseFloor * 2.4);
    const voiced = rms > threshold;

    if (voiced) {
      a.getFloatFrequencyData(this.fd as any);
      this.frames.push(melBands(this.fd, this.ctx.sampleRate));
      if (this.frames.length > BUFFER_FRAMES) this.frames.shift();
      this.silenceFrames = 0;
      if (!this.speaking) { this.speaking = true; this.h.onActivity?.(true); }
    } else {
      // Powolna adaptacja tła do otoczenia (muzyka/wentylator).
      this.noiseFloor = this.noiseFloor * 0.97 + rms * 0.03;
      this.silenceFrames++;
      if (this.speaking && this.silenceFrames > 6) { this.speaking = false; this.h.onActivity?.(false); }
    }
    this.h.onLevel?.(Math.min(1, rms * 12));
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    try { this.stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null; this.analyser = null; this.stream = null;
    this.frames = []; this.speaking = false;
  }
}
