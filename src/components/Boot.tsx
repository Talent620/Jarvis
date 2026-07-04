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

const BOOTED_KEY = "jarvis.booted";

/** Pure: plan czasu splashu. Pierwsze uruchomienie = pełne premium; kolejne = skrócone. */
export function bootPlan(hasBootedBefore: boolean): { totalMs: number; stepMs: number } {
  return hasBootedBefore ? { totalMs: 700, stepMs: 170 } : { totalMs: 1900, stepMs: 420 };
}

export default function Boot({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = useState(false);
  const [step, setStep] = useState(0);

  const finish = () => {
    setFading(true);
    setTimeout(onDone, 420); // po fade-out
  };

  // Splash uruchamiany raz przy montażu (timery sprzątane w cleanupie) — `finish` celowo poza deps.
  useEffect(() => {
    let booted = false;
    try { booted = localStorage.getItem(BOOTED_KEY) === "1"; localStorage.setItem(BOOTED_KEY, "1"); } catch { /* brak localStorage */ }
    const { totalMs, stepMs } = bootPlan(booted);
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), stepMs);
    const done = setTimeout(finish, totalMs);
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
