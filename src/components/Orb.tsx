export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const STATUS: Record<OrbState, string> = {
  idle: "System gotowy",
  listening: "Słucham…",
  thinking: "Analizuję…",
  speaking: "Mówię…",
};

export default function Orb({ state }: { state: OrbState }) {
  return (
    <div className="orb-wrap">
      <div className={`orb ${state}`}>
        <div className="ring r1" />
        <div className="ring r2" />
        <div className="ring r3" />
        <div className="core" />
      </div>
      <div className="orb-status">{STATUS[state]}</div>
    </div>
  );
}
