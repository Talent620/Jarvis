import type { Settings } from "../types";

export default function InterfaceModeSwitch({ mode, onChange }: {
  mode: Settings["interfaceMode"];
  onChange: (mode: "classic" | "pro") => void;
}) {
  return (
    <div className="interface-switch" role="group" aria-label="Tryb interfejsu">
      <button type="button" className={mode === "classic" ? "is-active" : ""}
        aria-pressed={mode === "classic"} onClick={() => onChange("classic")}>Classic</button>
      <button type="button" className={mode !== "classic" ? "is-active" : ""}
        aria-pressed={mode !== "classic"} onClick={() => onChange("pro")}>PRO NEW</button>
    </div>
  );
}
