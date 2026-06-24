// Wspólny przełącznik (switch) — wydzielony z Settings.tsx, by używać go w całej apce.
// Wygląd 1:1 (.switch / .switch.on), zachowanie identyczne (klik = onClick). Dodatkowo
// semantyka dla czytników ekranu (role="switch" + aria-checked) — bez zmiany kolejności
// tabulacji ani fokusu, więc nic się nie psuje w istniejących ekranach.
export default function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label?: string;
}): React.ReactElement {
  return <div className={`switch ${on ? "on" : ""}`} onClick={onClick} role="switch" aria-checked={on} aria-label={label} />;
}
