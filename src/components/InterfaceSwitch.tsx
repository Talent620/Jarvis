import { useStore } from "../hooks/useStore";
import { store } from "../lib/store";
import type { InterfaceMode } from "../lib/interfaceMode";

export default function InterfaceSwitch() {
  const { settings } = useStore();
  const current = settings.interfaceMode === "modern" ? "modern" : "classic";
  return <div className="interface-switch" role="group" aria-label="Interfejs">
    <span>Interfejs:</span>
    {([ ["classic", "Klasyczny"], ["modern", "Nowy"] ] as [InterfaceMode, string][]).map(([mode, label]) =>
      <button key={mode} type="button" aria-pressed={current === mode} onClick={() => store.setSettings({ interfaceMode: mode })}>{label}</button>)}
  </div>;
}
