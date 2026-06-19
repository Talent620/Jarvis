import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Activity, BrainCircuit, Cpu, Radio, ShieldCheck, Wifi, Zap } from "lucide-react";
import VoiceCore, { type CoreState } from "./VoiceCore";
import CognitiveStream, { type ThoughtLine } from "./CognitiveStream";
import { subscribeLevel } from "../../lib/audioLevel";
import { subscribeLog, reliabilityStats, type LogEvent } from "../../lib/errorLog";
import { store } from "../../lib/store";
import "./neural.css";

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

// Realna telemetria → linia „myśli”. Bez treści użytkownika — tylko scope/komunikat/latencja.
function eventToLine(e: LogEvent): ThoughtLine {
  const kind: ThoughtLine["kind"] = e.level === "error" ? "warn" : e.level === "warn" ? "warn" : "ok";
  const ms = typeof e.ms === "number" ? ` (${e.ms} ms)` : "";
  const ctx = e.ctx ? ` · ${e.ctx}` : "";
  const msg = e.message === "ok" ? "odpowiedź dostarczona" : e.message;
  return { id: `${e.at}-${Math.random().toString(36).slice(2, 6)}`, text: `${e.scope}${ctx}: ${msg}${ms}`, kind };
}

// Demo-scenariusz strumienia myśli (zastąp realnymi zdarzeniami z logiki).
const SCRIPT: { state: CoreState; line: string; kind?: ThoughtLine["kind"] }[] = [
  { state: "idle", line: "Rdzeń online. Czekam na polecenie.", kind: "info" },
  { state: "listening", line: "Wykryto głos — przechwytuję mowę…", kind: "info" },
  { state: "listening", line: "Transkrypcja: „przygotuj raport na jutro”.", kind: "ok" },
  { state: "speaking", line: "Routing → wybrano model o najwyższej randze.", kind: "info" },
  { state: "speaking", line: "Świadomość sytuacyjna: 2 otwarte wątki dopasowane.", kind: "warn" },
  { state: "speaking", line: "Generuję odpowiedź (strumieniowo)…", kind: "info" },
  { state: "idle", line: "Gotowe. Wynik dostarczony.", kind: "ok" },
];

// Mały, „szklany” wskaźnik HUD.
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
 * NEURAL INTERFACE — futurystyczny pulpit JARVIS-a (warstwa wizualna, opt-in).
 * Trzy strefy: górny HUD (status modeli/API), centralna scena (VoiceCore),
 * prawy/dolny pasek (Strumień poznawczy). Wszystkie stany na useState — gotowe
 * do podpięcia istniejącej logiki bez zmiany API.
 */
export default function NeuralInterface() {
  const [manualState, setManualState] = useState<CoreState>("idle");
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<ThoughtLine[]>([]);
  const [live, setLive] = useState(false); // czy płynie REALNA telemetria
  const step = useRef(0);
  const seq = useRef(0);

  // REALNY poziom audio z audioLevel.ts (TTS JARVIS-a) — orb „mówi" w rytm dźwięku.
  useEffect(() => subscribeLevel(setLevel), []);

  // REALNE myśli ze strumienia telemetrii (errorLog.ts): routing, latencja, błędy.
  // Pierwsze realne zdarzenie przełącza pulpit w tryb „live" (gasi demo).
  useEffect(
    () =>
      subscribeLog((e) => {
        setLive(true);
        setLines((prev) => [...prev, eventToLine(e)].slice(-60));
      }),
    [],
  );

  // Ambientowe „życie" — TYLKO dopóki nie ma realnej telemetrii (np. samodzielny podgląd
  // #neural bez aktywnej rozmowy). Gdy ruszy prawdziwy ruch, demo cichnie samo.
  useEffect(() => {
    if (live) return;
    const t = setInterval(() => {
      const s = SCRIPT[step.current % SCRIPT.length];
      step.current += 1;
      setManualState(s.state);
      setLines((prev) => [...prev, { id: `l${seq.current++}`, text: s.line, kind: s.kind }].slice(-40));
    }, 2200);
    return () => clearInterval(t);
  }, [live]);

  // Realny HUD (model/tryb/łącze/latencja) — odczyt store + metryk, odświeżany lekko.
  const [hud, setHud] = useState<HudState>(readHud);
  useEffect(() => {
    const t = setInterval(() => setHud(readHud()), 2000);
    const on = () => setHud(readHud());
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  // Stan rdzenia: realny dźwięk (mowa) ma pierwszeństwo; inaczej stan demo/ręczny.
  const coreState: CoreState = level > 0.04 ? "speaking" : manualState;
  const setCoreState = setManualState;

  return (
    <div className="neural-root relative h-screen w-screen overflow-hidden bg-zinc-950 font-sans text-zinc-200">
      {/* Tło: siatka HUD + delikatne poświaty */}
      <div className="neural-grid-bg animate-neural-grid absolute inset-0 opacity-50" />
      <div className="pointer-events-none absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-neural-cyan/10 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-96 w-96 rounded-full bg-neural-blue/10 blur-[120px]" />

      {/* ───────── STREFA A: górny HUD (status modeli/API) ───────── */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 p-4">
        <div className="flex items-center gap-2.5 rounded-xl border border-neural-line bg-neural-glass px-3.5 py-2 backdrop-blur-xl">
          <BrainCircuit size={18} className="text-neural-cyan" />
          <span className="font-mono text-sm font-semibold tracking-[0.2em] text-zinc-100">J.A.R.V.I.S</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Realne wartości (read-only) ze store + metryk — bez dotykania logiki API. */}
          <HudChip icon={<Cpu size={16} />} label="Model" value={hud.model} color="#22d3ee" />
          <HudChip icon={<Activity size={16} />} label="Latencja p50" value={hud.latency} color="#34d399" />
          <HudChip icon={<ShieldCheck size={16} />} label="Tryb" value={hud.mode} color="#fbbf24" />
          <HudChip icon={<Wifi size={16} />} label="Łącze" value={hud.online ? "online" : "offline"} color={hud.online ? "#3b82f6" : "#ef4444"} />
        </div>
      </header>

      {/* ───────── układ: scena + prawy pasek ───────── */}
      <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_380px]">
        {/* STREFA B: centralna scena (VoiceCore) */}
        <main className="relative flex flex-col items-center justify-center gap-10 px-6">
          <VoiceCore state={coreState} level={level} />

          {/* Sterowanie stanem (demo — w produkcji napędza to logika głosu). */}
          <div className="flex items-center gap-2">
            {(["idle", "listening", "speaking"] as CoreState[]).map((s) => (
              <button
                key={s}
                onClick={() => setCoreState(s)}
                className={`rounded-full border px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] backdrop-blur transition-colors ${
                  coreState === s
                    ? "border-neural-cyan/60 bg-neural-cyan/10 text-neural-cyan"
                    : "border-neural-line bg-white/5 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            className="absolute bottom-6 flex items-center gap-2 font-mono text-[11px] text-zinc-500"
          >
            <Radio size={12} className="text-neural-green" /> nasłuch pasywny aktywny
          </motion.p>
        </main>

        {/* STREFA C: prawy pasek (Strumień poznawczy) */}
        <aside className="relative z-10 hidden p-4 lg:block">
          <CognitiveStream lines={lines} />
        </aside>
      </div>

      {/* Strumień poznawczy na mobile (dół ekranu) */}
      <div className="absolute inset-x-0 bottom-0 z-10 h-44 p-4 lg:hidden">
        <CognitiveStream lines={lines} max={6} />
      </div>

      {/* Powrót do klasycznego interfejsu (to opcjonalna nakładka, nie zamiennik). */}
      <button
        onClick={() => { window.location.hash = ""; }}
        className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-lg border border-neural-line bg-neural-glass px-3 py-1.5 font-mono text-[11px] text-zinc-400 backdrop-blur-xl hover:text-zinc-100"
      >
        <Zap size={12} /> klasyczny interfejs
      </button>
    </div>
  );
}
