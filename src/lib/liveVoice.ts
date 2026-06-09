// Rozmowa głosowa na żywo przez Gemini Live API (WebSocket, audio↔audio).
// Mikrofon → PCM16 16 kHz → Gemini; odpowiedź PCM16 24 kHz → głośnik.

const LIVE_MODEL = "models/gemini-2.0-flash-live-001";

export type LiveState = "connecting" | "listening" | "speaking" | "closed" | "error";

// --- Pomocnicze: konwersje audio ---

function downsampleTo16k(input: Float32Array, inRate: number): Int16Array {
  const ratio = inRate / 16000;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToPcm16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export class LiveSession {
  private ws?: WebSocket;
  private inCtx?: AudioContext;
  private outCtx?: AudioContext;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private stream?: MediaStream;
  private playHead = 0;
  private sources: AudioBufferSourceNode[] = [];
  private closed = false;

  constructor(
    private apiKey: string,
    private system: string,
    private onState: (s: LiveState) => void,
    private onText?: (t: string) => void,
  ) {}

  async start(): Promise<void> {
    this.onState("connecting");
    const url =
      `wss://generativelanguage.googleapis.com/ws/` +
      `google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.ws!.send(
        JSON.stringify({
          setup: {
            model: LIVE_MODEL,
            generationConfig: { responseModalities: ["AUDIO"] },
            systemInstruction: { parts: [{ text: this.system }] },
          },
        }),
      );
    };
    this.ws.onmessage = (ev) => this.onMessage(ev);
    this.ws.onerror = () => this.onState("error");
    this.ws.onclose = () => {
      if (!this.closed) this.onState("closed");
    };
  }

  private async onMessage(ev: MessageEvent): Promise<void> {
    const txt = ev.data instanceof Blob ? await ev.data.text() : (ev.data as string);
    let msg: any;
    try {
      msg = JSON.parse(txt);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      await this.startMic();
      this.onState("listening");
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.interrupted) this.flushPlayback();
    const parts = sc.modelTurn?.parts || [];
    for (const p of parts) {
      if (p.inlineData?.data) {
        this.enqueueAudio(p.inlineData.data);
        this.onState("speaking");
      }
      if (p.text && this.onText) this.onText(p.text);
    }
    if (sc.turnComplete) this.onState("listening");
  }

  private async startMic(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.inCtx = new AudioContext();
    this.source = this.inCtx.createMediaStreamSource(this.stream);
    this.processor = this.inCtx.createScriptProcessor(4096, 1, 1);
    const inRate = this.inCtx.sampleRate;
    this.processor.onaudioprocess = (e) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const pcm = downsampleTo16k(e.inputBuffer.getChannelData(0), inRate);
      this.ws.send(
        JSON.stringify({
          realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: pcm16ToBase64(pcm) }] },
        }),
      );
    };
    this.source.connect(this.processor);
    this.processor.connect(this.inCtx.destination);

    this.outCtx = new AudioContext({ sampleRate: 24000 });
    this.playHead = this.outCtx.currentTime;
  }

  private enqueueAudio(b64: string): void {
    if (!this.outCtx) return;
    const pcm = base64ToPcm16(b64);
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
    const buf = this.outCtx.createBuffer(1, f32.length, 24000);
    buf.copyToChannel(f32, 0);
    const src = this.outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(this.outCtx.destination);
    const now = this.outCtx.currentTime;
    if (this.playHead < now) this.playHead = now;
    src.start(this.playHead);
    this.playHead += buf.duration;
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
    this.sources.push(src);
  }

  private flushPlayback(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* ignore */
      }
    }
    this.sources = [];
    if (this.outCtx) this.playHead = this.outCtx.currentTime;
  }

  stop(): void {
    this.closed = true;
    this.flushPlayback();
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      this.inCtx?.close();
      this.outCtx?.close();
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.onState("closed");
  }
}
