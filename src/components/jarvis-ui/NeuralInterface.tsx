import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Activity, BrainCircuit, Cpu, Radio, ShieldCheck, Wifi, Zap } from "lucide-react";
import VoiceCore, { type CoreState } from "./VoiceCore";
import CognitiveStream, { type ThoughtLine } from "./CognitiveStream";
import "./neural.css";

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
  const [coreState, setCoreState] = useState<CoreState>("idle");
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<ThoughtLine[]>([]);
  const step = useRef(0);
  const seq = useRef(0);

  // Demo „życia” interfejsu. Cyklicznie odgrywa SCRIPT, by pulpit wyglądał na żywy.
  // TODO: Connect to voiceCapture.ts state here — ustaw setCoreState('listening'|'speaking'|'idle')
  // TODO: Connect to audioLevel.ts here — setLevel(rms) w trakcie mowy (0..1).
  // TODO: Connect to chat/errorLog.ts here — pushLine(realna myśl) zamiast SCRIPT.
  useEffect(() => {
    const t = setInterval(() => {
      const s = SCRIPT[step.current % SCRIPT.length];
      step.current += 1;
      setCoreState(s.state);
      setLines((prev) => [...prev, { id: `l${seq.current++}`, text: s.line, kind: s.kind }].slice(-40));
    }, 2200);
    return () => clearInterval(t);
  }, []);

  // Symulacja poziomu audio w trakcie „mówienia”.
  // TODO: Replace with real RMS from audioLevel.ts subscription.
  useEffect(() => {
    if (coreState !== "speaking") {
      setLevel(0);
      return;
    }
    const t = setInterval(() => setLevel(0.3 + Math.random() * 0.7), 120);
    return () => clearInterval(t);
  }, [coreState]);

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
          {/* TODO: Connect to resolveProvider()/apiStatus.ts — pokaż realny model/dostawcę. */}
          <HudChip icon={<Cpu size={16} />} label="Model" value="auto · opus-4.8" color="#22d3ee" />
          <HudChip icon={<Activity size={16} />} label="Latencja" value="142 ms" color="#34d399" />
          <HudChip icon={<ShieldCheck size={16} />} label="Tryb" value="suwerenny" color="#fbbf24" />
          <HudChip icon={<Wifi size={16} />} label="Łącze" value="online" color="#3b82f6" />
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
