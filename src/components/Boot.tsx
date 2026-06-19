import { useEffect, useState } from "react";
import Orb from "./Orb";

// Ładne „włączanie": premium ekran startowy — orb rozpala się, lecą komunikaty
// uruchamiania, potem płynne zniknięcie. Tap = pomiń. Pokazywany raz przy starcie.
const STEPS = [
  "Uruchamianie rdzenia…",
  "Synchronizacja systemów…",
  "Kalibracja głosu…",
  "Gotowy.",
];

export default function Boot({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const [step, setStep] = useState(0);

  const finish = () => {
    setFading(true);
    setTimeout(onDone, 420); // po fade-out
  };

  // Splash uruchamiany raz przy montażu (timery sprzątane w cleanupie) — `finish` celowo poza deps.
  useEffect(() => {
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 420);
    const done = setTimeout(finish, 1900);
    return () => { clearInterval(tick); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`boot ${fading ? "boot-out" : ""}`} onClick={finish} role="presentation">
      <div className="boot-brand">JARVIS</div>
      <Orb state="thinking" label="" />
      <div className="boot-step">{STEPS[step]}</div>
      <div className="boot-bar"><span /></div>
    </div>
  );
}
