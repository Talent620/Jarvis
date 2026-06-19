import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { Activity, BrainCircuit, CornerDownLeft, Cpu, Radio, SendHorizonal, ShieldCheck, Sparkles, Wifi, Zap } from "lucide-react";
import VoiceCore, { type CoreState } from "./VoiceCore";
import CognitiveStream, { type ThoughtLine } from "./CognitiveStream";
import { subscribeLevel } from "../../lib/audioLevel";
import { subscribeLog, reliabilityStats, logError, type LogEvent } from "../../lib/errorLog";
import { store } from "../../lib/store";
import { askJarvis, resolveProvider } from "../../lib/brain";
import { speak, stopSpeaking } from "../../lib/voice";
import type { Msg } from "../../lib/providers/types";
import "./neural.css";

// Realna telemetria → linia „myśli”. Bez treści użytkownika — tylko scope/komunikat/latencja.
function eventToLine(e: LogEvent): ThoughtLine {
  const kind: ThoughtLine["kind"] = e.level === "error" ? "warn" : e.level === "warn" ? "warn" : "ok";
  const ms = typeof e.ms === "number" ? ` (${e.ms} ms)` : "";
  const ctx = e.ctx ? ` · ${e.ctx}` : "";
  const msg = e.message === "ok" ? "odpowiedź dostarczona" : e.message;
  return { id: `${e.at}-${Math.random().toString(36).slice(2, 6)}`, text: `${e.scope}${ctx}: ${msg}${ms}`, kind };
}

interface HudState { model: string; mode: string; online: boolean; latency: string }
function readHud(): HudState {
  const s = store.settings;
  const model = s.provider === "auto" || !s.model || s.model === "auto" ? "auto" : s.model;
  const p50 = reliabilityStats().latencyP50;
  return {
    model: `${s.provider} · ${model}`.slice(0, 26),
    mode: s.onDeviceOnly ? "on-device" : "chmura / auto",
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    latency: typeof p50 === "number" ? `${p50} ms` : "—",
  };
}

// Ambientowe „życie” — odgrywane TYLKO zanim użytkownik zacznie rozmowę.
const SCRIPT: { state: CoreState; line: string; kind?: ThoughtLine["kind"] }[] = [
  { state: "idle", line: "Rdzeń online. Czekam na polecenie.", kind: "info" },
  { state: "listening", line: "Pasywny nasłuch aktywny…", kind: "info" },
  { state: "speaking", line: "Świadomość sytuacyjna: skanuję otwarte wątki.", kind: "warn" },
  { state: "idle", line: "Gotowy.", kind: "ok" },
];

function HudChip({ icon, label, value, color }: { icon: ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-neural-line bg-neural-glass px-3 py-2 backdrop-blur-xl">
      <span style={{ color }}>{icon}</span>
      <div className="leading-tight">
        <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-500">{label}</div>
        <div className="font-mono text-[12px] text-zinc-200">{value}</div>
      </div>
    </div>
  );
}

/**
 * NEURAL INTERFACE — premium „Focus Mode": kinowy, bezrozpraszający tryb rozmowy.
 * Cienka warstwa wizualna na istniejących systemach (read-only askJarvis ze STREAMINGIEM,
 * Szósty Zmysł, telemetria, TTS). Zero zmian w API/LLM/auth. Opcjonalny (#neural).
 */
export default function NeuralInterface() {
  const [manualState, setManualState] = useState<CoreState>("idle");
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<ThoughtLine[]>([]);
  const [live, setLive] = useState(false);
  const [hud, setHud] = useState<HudState>(readHud);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [focused, setFocused] = useState(false);
  const step = useRef(0);
  const seq = useRef(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const started = history.length > 0 || live;

  // Realne sygnały (read-only): poziom TTS → orb; telemetria → strumień myśli.
  useEffect(() => subscribeLevel(setLevel), []);
  useEffect(() => subscribeLog((e) => { setLive(true); setLines((p) => [...p, eventToLine(e)].slice(-60)); }), []);

  // HUD odświeżany lekko + reakcja na online/offline.
  useEffect(() => {
    const t = setInterval(() => setHud(readHud()), 2000);
    const on = () => setHud(readHud());
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  // Ambient demo — tylko zanim ruszy rozmowa/telemetria.
  useEffect(() => {
    if (started) return;
    const t = setInterval(() => {
      const s = SCRIPT[step.current % SCRIPT.length];
      step.current += 1;
      setManualState(s.state);
      setLines((prev) => [...prev, { id: `l${seq.current++}`, text: s.line, kind: s.kind }].slice(-40));
    }, 2400);
    return () => clearInterval(t);
  }, [started]);

  // Esc → powrót do klasycznego interfejsu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") window.location.hash = ""; };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); stopSpeaking(); };
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!resolveProvider()) {
      setAnswer("Brak skonfigurowanego dostawcy AI. Wejdź w klasyczny interfejs → ⚙ Ustawienia i dodaj klucz.");
      setLines((p) => [...p, { id: `e${seq.current++}`, text: "neural: brak klucza API", kind: "warn" }]);
      return;
    }
    setInput("");
    stopSpeaking();
    const userMsg: Msg = { role: "user", content: text };
    const next = [...history, userMsg];
    setHistory(next);
    setBusy(true);
    setAnswer("");
    setLines((p) => [...p, { id: `u${seq.current++}`, text: `użytkownik: ${text.slice(0, 80)}`, kind: "info" }]);
    let acc = "";
    try {
      const reply = await askJarvis(next, (full) => { acc = full; setAnswer(full); });
      const finalText = (reply.text || acc || "").trim() || "…";
      setAnswer(finalText);
      setHistory((h) => [...h, { role: "assistant", content: finalText }]);
      if (store.settings.speak) void speak(finalText, store.settings).catch(() => {});
    } catch (e) {
      logError("neural", e);
      setAnswer("⚠ " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  // Stan rdzenia: mowa (busy/TTS) > nasłuch (piszesz) > demo/idle.
  const coreState: CoreState =
    busy || level > 0.04 ? "speaking" : !started ? manualState : focused && input.trim() ? "listening" : "idle";

  const reveal = (delay: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease: "easeOut" as const },
  });

  return (
    <MotionConfig reducedMotion="user">
      <div className="neural-root relative h-screen w-screen overflow-hidden bg-zinc-950 font-sans text-zinc-200">
        <div className="neural-grid-bg animate-neural-grid absolute inset-0 opacity-50" />
        <div className="pointer-events-none absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-neural-cyan/10 blur-[120px]" />
        <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-neural-blue/10 blur-[120px]" />

        {/* STREFA A — HUD */}
        <motion.header {...reveal(0)} className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 p-4">
          <div className="flex items-center gap-2.5 rounded-xl border border-neural-line bg-neural-glass px-3.5 py-2 backdrop-blur-xl">
            <BrainCircuit size={18} className="text-neural-cyan" />
            <span className="font-mono text-sm font-semibold tracking-[0.2em] text-zinc-100">J.A.R.V.I.S</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <HudChip icon={<Cpu size={16} />} label="Model" value={hud.model} color="#22d3ee" />
            <HudChip icon={<Activity size={16} />} label="Latencja p50" value={hud.latency} color="#34d399" />
            <HudChip icon={<ShieldCheck size={16} />} label="Tryb" value={hud.mode} color="#fbbf24" />
            <HudChip icon={<Wifi size={16} />} label="Łącze" value={hud.online ? "online" : "offline"} color={hud.online ? "#3b82f6" : "#ef4444"} />
          </div>
        </motion.header>

        {/* układ: scena + prawy pasek */}
        <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_380px]">
          {/* STREFA B — scena + Focus Mode */}
          <main className="relative flex flex-col items-center justify-center gap-7 px-6 pt-16">
            <motion.div {...reveal(0.1)}>
              <VoiceCore state={coreState} level={level} />
            </motion.div>

            {/* Odpowiedź (strumieniowa) lub podpowiedź startowa */}
            <div className="min-h-[92px] w-full max-w-2xl">
              <AnimatePresence mode="wait">
                {answer ? (
                  <motion.div
                    key="answer"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="rounded-2xl border border-neural-line bg-neural-glass px-5 py-4 text-[15px] leading-relaxed text-zinc-100 backdrop-blur-xl shadow-glow"
                    role="status"
                    aria-live="polite"
                  >
                    {answer}
                    {busy && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-neural-cyan align-middle" />}
                  </motion.div>
                ) : (
                  <motion.div key="hint" {...reveal(0.2)} className="flex flex-col items-center gap-2 text-center text-zinc-500">
                    <Sparkles size={18} className="text-neural-cyan/70" />
                    <p className="max-w-md font-mono text-[13px]">Zapytaj o cokolwiek. Odpowiem strumieniowo i połączę to z Twoimi otwartymi wątkami.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Pole rozmowy */}
            <motion.div {...reveal(0.25)} className="w-full max-w-2xl">
              <div className="flex items-end gap-2 rounded-2xl border border-neural-line bg-neural-glass p-2 backdrop-blur-xl focus-within:border-neural-cyan/50">
                <textarea
                  ref={taRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  rows={1}
                  placeholder="Wpisz polecenie…  (Enter wysyła, Esc wraca)"
                  aria-label="Pole rozmowy z JARVIS-em"
                  className="max-h-32 flex-1 resize-none bg-transparent px-3 py-2 font-sans text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                />
                <button
                  onClick={() => void send()}
                  disabled={busy || !input.trim()}
                  aria-label="Wyślij"
                  className="grid h-10 w-10 place-items-center rounded-xl bg-neural-cyan/15 text-neural-cyan transition-colors hover:bg-neural-cyan/25 disabled:opacity-40"
                >
                  <SendHorizonal size={18} />
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-center gap-1.5 font-mono text-[10px] text-zinc-600">
                <CornerDownLeft size={11} /> Enter wysyła · Shift+Enter nowa linia
              </div>
            </motion.div>

            <p className="absolute bottom-4 flex items-center gap-2 font-mono text-[11px] text-zinc-600">
              <Radio size={12} className="text-neural-green" /> {busy ? "przetwarzam…" : "nasłuch pasywny aktywny"}
            </p>
          </main>

          {/* STREFA C — strumień poznawczy */}
          <motion.aside {...reveal(0.15)} className="relative z-10 hidden p-4 lg:block">
            <CognitiveStream lines={lines} />
          </motion.aside>
        </div>

        {/* Strumień na mobile */}
        <div className="absolute inset-x-0 bottom-0 z-0 hidden h-40 p-4 max-lg:block">
          <CognitiveStream lines={lines} max={5} />
        </div>

        <button
          onClick={() => { window.location.hash = ""; }}
          aria-label="Wróć do klasycznego interfejsu"
          className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-lg border border-neural-line bg-neural-glass px-3 py-1.5 font-mono text-[11px] text-zinc-400 backdrop-blur-xl hover:text-zinc-100"
        >
          <Zap size={12} /> klasyczny interfejs
        </button>
      </div>
    </MotionConfig>
  );
}
