import { useEffect, useRef } from "react";
import { subscribeLevel } from "../lib/audioLevel";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const STATUS: Record<OrbState, string> = {
  idle: "System gotowy",
  listening: "Słucham…",
  thinking: "Analizuję…",
  speaking: "Mówię…",
};

export default function Orb({ state, label }: { state: OrbState; label?: string }) {
  const coreRef = useRef<HTMLDivElement>(null);

  // Orb pulsuje w rytm realnej głośności mowy JARVIS-a (gdy mówi).
  useEffect(() => {
    return subscribeLevel((v) => {
      const el = coreRef.current;
      if (!el) return;
      if (state === "speaking") {
        const scale = 1 + v * 0.5;
        el.style.transform = `scale(${scale.toFixed(3)})`;
        el.style.filter = `brightness(${(1 + v * 0.8).toFixed(2)})`;
      } else {
        el.style.transform = "";
        el.style.filter = "";
      }
    });
  }, [state]);

  return (
    <div className="orb-wrap">
      <div className={`orb ${state}`}>
        <div className="halo" />
        <div className="sweep" />
        <div className="ring r1" />
        <div className="ring r2" />
        <div className="ring r3" />
        <div className="core" ref={coreRef} />
      </div>
      <div className="orb-status">{label || STATUS[state]}</div>
    </div>
  );
}
