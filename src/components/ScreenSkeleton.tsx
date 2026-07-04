import { detectLowPower, readDeviceHints } from "../lib/performanceProfile";

// Lekki „szkielet" ładowania ekranu — zamiast martwej pustki (fallback=null) podczas leniwego importu.
// Na słabym sprzęcie / przy „ogranicz ruch" (S9) szkielet jest STATYCZNY (bez migotania), by nie
// obciążać GPU. Pokazuje nazwę ładowanego ekranu, żeby użytkownik wiedział, co się otwiera.
export default function ScreenSkeleton({ name }: { name?: string }): React.ReactElement {
  const lowPower = detectLowPower(readDeviceHints());
  const barClass = lowPower ? "skeleton-bar" : "skeleton-bar skeleton-shimmer";
  return (
    <div className="sheet" aria-busy="true" aria-live="polite">
      <div className="panel">
        <div className="panel-head">
          <div className="grabber" />
          <h2 style={{ opacity: 0.85 }}>{name ? `Otwieram: ${name}…` : "Otwieram…"}</h2>
        </div>
        <div className="panel-body">
          <div className={barClass} style={{ width: "70%", height: 18 }} />
          <div className={barClass} style={{ width: "100%", height: 44, marginTop: 12 }} />
          <div className={barClass} style={{ width: "90%", height: 44, marginTop: 10 }} />
          <div className={barClass} style={{ width: "60%", height: 44, marginTop: 10 }} />
        </div>
      </div>
    </div>
  );
}
