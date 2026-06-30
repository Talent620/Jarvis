// Wspólny przełącznik (switch) — wydzielony z Settings.tsx, by używać go w całej apce.
// Wygląd 1:1 (.switch / .switch.on). Teraz to SEMANTYCZNY <button>: natywnie fokusowalny i
// obsługiwany klawiaturą (Enter/Spacja), z role="switch" + aria-checked dla czytników ekranu.
// Propsy i zachowanie (klik = onClick) bez zmian — nic nie psuje się w istniejących ekranach.
export default function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`switch ${on ? "on" : ""}`}
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      // Reset domyślnych styli <button> (tło/obwódkę/promień daje klasa .switch).
      style={{ appearance: "none", WebkitAppearance: "none", padding: 0, margin: 0, font: "inherit", boxSizing: "border-box", touchAction: "manipulation" }}
    />
  );
}
