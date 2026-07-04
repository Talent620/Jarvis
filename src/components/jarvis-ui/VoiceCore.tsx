import { motion } from "framer-motion";

export type CoreState = "idle" | "listening" | "speaking";

interface VoiceCoreProps {
  /** Stan rdzenia — podłącz do stanu czatu/głosu (voiceCapture.ts, audioLevel.ts). */
  state?: CoreState;
  /** Poziom audio 0..1 — w stanie 'speaking' synchronizuje pulsowanie z dźwiękiem. */
  level?: number;
}

// Paleta i dynamika per-stan.
const PALETTE: Record<CoreState, { core: string; ring: string; glow: string; label: string }> = {
  idle: { core: "#22d3ee", ring: "rgba(34,211,238,0.35)", glow: "0 0 60px -10px rgba(34,211,238,0.55)", label: "GOTOWY" },
  listening: { core: "#34d399", ring: "rgba(52,211,153,0.5)", glow: "0 0 90px -6px rgba(52,211,153,0.75)", label: "SŁUCHAM" },
  speaking: { core: "#3b82f6", ring: "rgba(59,130,246,0.5)", glow: "0 0 90px -6px rgba(59,130,246,0.8)", label: "MÓWIĘ" },
};

/**
 * Centralny „rdzeń" JARVIS-a: pulsujący orb z warstwowymi pierścieniami.
 * - idle: powolny, łagodny oddech,
 * - listening: szybkie, szersze pulsowanie (zieleń),
 * - speaking: pulsowanie zsynchronizowane z `level` (niebieski).
 */
export default function VoiceCore({ state = "idle", level = 0 }: VoiceCoreProps) {
  const p = PALETTE[state];
  const lvl = Math.min(1, Math.max(0, level));

  // Dynamika oddechu rdzenia per-stan.
  const coreAnim =
    state === "idle"
      ? { scale: [1, 1.06, 1], opacity: [0.9, 1, 0.9] }
      : state === "listening"
        ? { scale: [1, 1.16, 1], opacity: [0.85, 1, 0.85] }
        : { scale: [1, 1 + 0.18 * (0.4 + lvl), 1], opacity: [0.9, 1, 0.9] };

  const coreDur = state === "idle" ? 3.4 : state === "listening" ? 1.1 : 0.5 + 0.5 * (1 - lvl);

  return (
    <div className="relative grid place-items-center" style={{ width: 320, height: 320 }} aria-label={`Rdzeń: ${p.label}`}>
      {/* Zewnętrzne pierścienie */}
      {[260, 200].map((size, i) => (
        <motion.span
          key={size}
          className="absolute rounded-full ring-pulse"
          style={{
            width: size,
            height: size,
            border: `1px solid ${p.ring}`,
            boxShadow: `inset 0 0 30px -10px ${p.ring}`,
            animationDelay: `${i * 0.6}s`,
          }}
        />
      ))}

      {/* Halo / poświata */}
      <motion.span
        className="absolute rounded-full"
        style={{ width: 150, height: 150, background: `radial-gradient(circle, ${p.ring} 0%, transparent 70%)`, boxShadow: p.glow }}
        animate={{ scale: state === "speaking" ? [1, 1.25, 1] : [1, 1.12, 1], opacity: [0.6, 0.9, 0.6] }}
        transition={{ duration: coreDur, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Rdzeń */}
      <motion.div
        className="relative rounded-full"
        style={{
          width: 96,
          height: 96,
          background: `radial-gradient(circle at 35% 30%, #ffffff22, ${p.core})`,
          boxShadow: `${p.glow}, inset 0 0 24px -6px #ffffff66`,
        }}
        animate={coreAnim}
        transition={{ duration: coreDur, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Equalizer (widoczny w 'speaking') */}
      {state === "speaking" && (
        <div className="absolute bottom-2 flex items-end gap-1" style={{ height: 22 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <motion.span
              key={i}
              className="w-1 rounded-full"
              style={{ background: p.core }}
              animate={{ height: [4, 6 + 16 * ((Math.sin(i) + 1.4) / 2) * (0.4 + lvl), 4] }}
              transition={{ duration: 0.45 + (i % 3) * 0.12, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </div>
      )}

      {/* Etykieta stanu */}
      <span
        className="absolute -bottom-8 font-mono text-[11px] tracking-[0.35em] uppercase"
        style={{ color: p.core }}
      >
        {p.label}
      </span>
    </div>
  );
}
