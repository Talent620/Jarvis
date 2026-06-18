// Rozmowa głosowa na żywo przez Gemini Live API (WebSocket, audio↔audio).
// Mikrofon → PCM16 16 kHz → Gemini; odpowiedź PCM16 24 kHz → głośnik.

const LIVE_MODEL = "models/gemini-2.0-flash-live-001";

import { setLevel } from "./audioLevel";
import { micAudioConstraints } from "./mic";

export type LiveState = "connecting" | "listening" | "speaking" | "closed" | "error";

// Model Live bywa „rozmowny" i potrafi wypluć w treści pseudo-wywołania narzędzi
// (tool_code, print(default_api.…)) zamiast mówić — to NIE jest tekst dla użytkownika.
// Wycinamy takie fragmenty z napisów, by nie pokazywać surowego „kodu" na ekranie.
export function cleanLiveText(t: string): string {
  return (t || "")
    .replace(/```(?:tool_code|python|json|tool_outputs?)?[\s\S]*?```/gi, "") // bloki kodu/narzędzi
    .replace(/^\s*tool_(code|outputs?)\b.*$/gim, "") // linie zaczynające się od tool_code/tool_outputs
    .replace(/\bprint\s*\(\s*default_api\.[\s\S]*?\)\s*/gi, "") // print(default_api.foo(...))
    .replace(/\bdefault_api\.\w+\s*\([^)]*\)/gi, "") // gołe wywołania default_api.foo(...)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Zamień kod/treść zamknięcia WebSocketu na zrozumiałą przyczynę.
export function closeReason(code: number, reason?: string): string | undefined {
  const r = (reason || "").trim();
  if (/api key|api_key|unauthor|permission|denied|invalid/i.test(r))
    return "Nieprawidłowy lub niepełnoprawny klucz Gemini (sprawdź ⚙).";
  if (/quota|exceed|rate|exhaust/i.test(r)) return "Przekroczony limit Gemini Live — spróbuj później.";
  if (/model/i.test(r)) return "Model Gemini Live niedostępny dla tego klucza.";
  if (code === 1011) return "Błąd po stronie serwera Gemini — spróbuj ponownie.";
  if (code === 1006) return "Połączenie przerwane (sieć). Sprawdź internet.";
  return r || undefined;
}

// --- Narzędzia w sesji live (function calling) ---
// Bezpieczeństwo: do głosu live wystawiamy TYLKO narzędzia odczytu i lokalnego zapisu
// (odwracalne, z undo) oraz narzędzia MCP (skonfigurowane, na allowliście). Narzędzia
// `outbound` (wysyłka maila, telefon, smart-home, sterowanie pulpitem itd.) są POMIJANE —
// w trybie live nie ma bramki zgody (consentHandler), więc błędne rozpoznanie mowy nie
// może wywołać nieodwracalnej akcji. Pełny agentowy tok z potwierdzeniami pozostaje w
// czacie tekstowym i w „Trybie rozmowy" (dowolny model, przez askJarvis).

export interface LiveToolDecl {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Definicja narzędzia (kształt z tools.ts) — minimalny, by uniknąć zależności cyklicznej. */
interface ToolDefLike {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** Wybierz narzędzia bezpieczne dla głosu live i zmapuj do deklaracji funkcji Gemini.
 *  `riskOf` wstrzykiwane (z permissions.ts), by funkcja pozostała czysta/testowalna. */
export function liveToolDeclarations(
  defs: ToolDefLike[],
  riskOf: (name: string) => "read" | "write" | "outbound",
): LiveToolDecl[] {
  return defs
    .filter((d) => d.name.startsWith("mcp_") || riskOf(d.name) !== "outbound")
    .map((d) => ({ name: d.name, description: d.description, parameters: d.input_schema }));
}

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
    private onState: (s: LiveState, detail?: string) => void,
    private onText?: (t: string) => void,
    // Narzędzia (function calling) — bezpieczny podzbiór; `runTool` wykonuje wywołanie.
    private tools: LiveToolDecl[] = [],
    private runTool?: (name: string, args: unknown) => Promise<string>,
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
            // Transkrypcja audio → napisy w czasie rzeczywistym (co mówi JARVIS).
            outputAudioTranscription: {},
            inputAudioTranscription: {},
            // Narzędzia (jeśli są) — bezpieczny podzbiór; model woła je przez toolCall.
            ...(this.tools.length ? { tools: [{ functionDeclarations: this.tools }] } : {}),
          },
        }),
      );
    };
    this.ws.onmessage = (ev) => this.onMessage(ev);
    this.ws.onerror = () => {
      if (!this.closed) { this.teardownOnError(); this.onState("error", "Nie udało się połączyć z Gemini Live."); }
    };
    this.ws.onclose = (ev) => {
      if (this.closed) return;
      // Kod 1000 = normalne zamknięcie; inne wskazują przyczynę (klucz, model, limit).
      const reason = closeReason(ev.code, ev.reason);
      if (ev.code !== 1000) this.teardownOnError(); // zwolnij mic/konteksty — inaczej retry stackuje
      this.onState(ev.code === 1000 ? "closed" : "error", reason);
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

    // Błąd zgłoszony przez serwer (np. nieprawidłowy klucz, brak dostępu do modelu).
    if (msg.error?.message) {
      this.onState("error", msg.error.message);
      return;
    }

    // Model prosi o wykonanie narzędzia (function calling).
    if (msg.toolCall?.functionCalls?.length) {
      await this.handleToolCall(msg.toolCall.functionCalls);
      return;
    }

    if (msg.setupComplete) {
      try {
        await this.startMic();
      } catch {
        this.onState("error", "Brak dostępu do mikrofonu. Zezwól na mikrofon w ustawieniach aplikacji.");
        return;
      }
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
      if (p.text && this.onText) {
        const clean = cleanLiveText(p.text);
        if (clean) this.onText(clean);
      }
    }
    // Napisy z transkrypcji mowy JARVIS-a (responseModalities = AUDIO nie zwraca tekstu w parts).
    if (sc.outputTranscription?.text && this.onText) {
      const clean = cleanLiveText(sc.outputTranscription.text);
      if (clean) this.onText(clean);
    }
    if (sc.turnComplete) this.onState("listening");
  }

  // Wykonaj narzędzia zażądane przez model i odeślij wyniki (toolResponse).
  private async handleToolCall(calls: Array<{ id?: string; name: string; args?: unknown }>): Promise<void> {
    const responses: Array<{ id?: string; name: string; response: { result: string } }> = [];
    for (const c of calls) {
      let result = "Narzędzie niedostępne w trybie live.";
      if (this.runTool) {
        try {
          result = await this.runTool(c.name, c.args ?? {});
        } catch (e) {
          result = `Błąd narzędzia: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      responses.push({ id: c.id, name: c.name, response: { result } });
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
    }
  }

  private async startMic(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: micAudioConstraints({ channelCount: 1, echoCancellation: true, noiseSuppression: true }),
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
    if (!pcm.length) return; // pusty/uszkodzony chunk → nie twórz bufora 0-długości (NaN w poziomie)
    const f32 = new Float32Array(pcm.length);
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
      f32[i] = pcm[i] / 32768;
      sum += f32[i] * f32[i];
    }
    setLevel(Math.min(1, Math.sqrt(sum / Math.max(1, f32.length)) * 3)); // orb pulsuje z mową
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
    setLevel(0);
  }

  // Zwolnij zasoby audio + WS (idempotentnie). Bez zmiany stanu — używane też na
  // ścieżce błędu (onerror/onclose), żeby nieudane połączenie nie zostawiało
  // otwartego mikrofonu i dwóch AudioContextów przy ponownych próbach.
  private torn = false;
  private teardownOnError(): void {
    if (this.torn) return;
    this.torn = true;
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
  }

  stop(): void {
    this.closed = true;
    this.flushPlayback();
    this.teardownOnError();
    this.onState("closed");
  }
}
