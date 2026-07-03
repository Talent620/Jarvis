import { store } from "../lib/store";
import { useStore } from "../hooks/useStore";
import { DOCK_OPTIONS, normalizeDock } from "../lib/panelDock";

// Przełącznik dokowania okna: ⬅ ⬜ ➡ (lewo / środek / prawo). Zmienia GLOBALNE ustawienie
// panelDock — działa na WSZYSTKIE panele naraz (klasa <body> steruje układem). Widoczny tylko
// na desktopie (CSS .dock-switcher chowa go na wąskich ekranach). Umieszczany w nagłówku panelu.
export default function DockSwitcher() {
  useStore(); // re-render przy zmianie ustawień (podświetlenie aktywnej opcji)
  const cur = normalizeDock(store.settings.panelDock);
  return (
    <div className="dock-switcher" role="group" aria-label="Dokowanie okna">
      {DOCK_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          className={cur === o.id ? "on" : ""}
          title={o.hint}
          aria-label={o.hint}
          aria-pressed={cur === o.id}
          onClick={() => store.setSettings({ panelDock: o.id })}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
