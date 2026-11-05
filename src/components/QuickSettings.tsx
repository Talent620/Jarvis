import { useEffect, useState } from "react";
import { AudioLines, Bot, Palette, Workflow } from "lucide-react";
import { useStore } from "../hooks/useStore";
import { store } from "../lib/store";
import { resolveProvider } from "../lib/brain";
import { loadGoals, subscribeGoals } from "../lib/goalState";
import { PROVIDERS } from "../lib/providers/registry";
import type { SettingsTab } from "../lib/settingsModel";
import InterfaceModeSwitch from "./InterfaceModeSwitch";
import Modal from "./Modal";
import Toggle from "./Toggle";

const PALETTES = [
  { id: "violet", label: "Indygo" },
  { id: "cyan", label: "Cyjan" },
  { id: "amber", label: "Bursztyn" },
] as const;

export default function QuickSettings({ onClose, onAdvanced, onQueue, onRuntime }: {
  onClose: () => void;
  onAdvanced: (tab?: SettingsTab, anchor?: string) => void;
  onQueue: () => void;
  onRuntime?: () => void;
}) {
  const { settings } = useStore();
  const [queue, setQueue] = useState<{ queued: number; running: number } | null>(null);
  const [queueError, setQueueError] = useState(false);
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void loadGoals().then((goals) => {
        if (disposed) return;
        setQueue({ queued: goals.filter((goal) => goal.status === "queued").length,
          running: goals.filter((goal) => goal.status === "running").length });
        setQueueError(false);
      }).catch(() => { if (!disposed) setQueueError(true); });
    };
    refresh();
    const unsubscribe = subscribeGoals(refresh);
    return () => { disposed = true; unsubscribe(); };
  }, []);

  const provider = resolveProvider();
  const configured = Boolean(provider?.apiKey || settings.proxyUrl?.trim() || settings.ollamaUrl?.trim() || settings.webllmEnabled);
  const autonomous = settings.autonomousQueue !== false;
  const preset = () => store.setSettings({ autonomousQueue: true, intelligenceMode: "maximum", deepThink: true, verifyHard: true });

  return (
    <Modal title="Ustawienia" onClose={onClose} className="quick-settings"
      foot={<div className="quick-settings-actions"><button className="btn" onClick={() => onAdvanced()}>Zaawansowane</button><button className="btn primary" onClick={onClose}>Gotowe</button></div>}>
      <p className="quick-settings-description">Najważniejsze opcje w jednym miejscu. Zmiany zapisują się od razu.</p>
      <div className="quick-settings-grid">
        <section className="quick-settings-card" aria-labelledby="quick-ai">
          <div className="quick-settings-heading"><Bot size={21} aria-hidden="true" /><h3 id="quick-ai">Model AI</h3></div>
          <strong>{provider ? PROVIDERS[provider.provider].label : settings.ollamaUrl?.trim() ? "Ollama" : "Wybór automatyczny"}</strong>
          <p className="quick-settings-description">{provider?.model || settings.ollamaModelComplex || "Model dobierany do zadania"}</p>
          <p className="muted">{configured ? "Konfiguracja zapisana. Połączenie sprawdzisz w opcjach modelu." : "Dodaj klucz dostawcy lub połącz lokalny model, aby JARVIS mógł wykonywać złożone polecenia."}</p>
          <button className="btn" onClick={() => onAdvanced("ai", "set-provider")}>{configured ? "Zmień lub sprawdź model" : "Połącz model AI"}</button>
        </section>

        <section className="quick-settings-card" aria-labelledby="quick-autonomy">
          <div className="quick-settings-heading"><Workflow size={21} aria-hidden="true" /><h3 id="quick-autonomy">Autonomia</h3></div>
          <div className="quick-settings-presets" role="group" aria-label="Sposób uruchamiania zadań">
            <button className={`btn${autonomous ? " primary" : ""}`} aria-pressed={autonomous} onClick={preset}>Autonomicznie</button>
            <button className={`btn${!autonomous ? " primary" : ""}`} aria-pressed={!autonomous}
              onClick={() => store.setSettings({ autonomousQueue: false })}>Uruchamiam ręcznie</button>
          </div>
          <p className="muted">{autonomous
            ? "JARVIS podejmuje kolejne cele przy otwartej aplikacji i zapisuje postęp."
            : "Nowe cele czekają na włączenie kolejki. Rozpoczęte zadanie może jeszcze dokończyć pracę."}</p>
          <p className="muted">{settings.intelligenceMode === "maximum" && settings.deepThink && settings.verifyHard
            ? "Pełna analiza i sprawdzanie trudnych odpowiedzi są włączone."
            : "Przycisk „Autonomicznie” włącza również pełną analizę i sprawdzanie trudnych odpowiedzi."}</p>
          <p className="quick-settings-description" role="status">{queueError ? "Nie udało się odczytać kolejki." : queue ? `W kolejce: ${queue.queued} · W trakcie: ${queue.running}` : "Odczytuję kolejkę…"}</p>
          <button className="btn" onClick={onQueue}>Otwórz kolejkę i wyniki</button>
          {onRuntime && <button className="btn" onClick={onRuntime}>Analizy w tle</button>}
        </section>

        <section className="quick-settings-card" aria-labelledby="quick-voice">
          <div className="quick-settings-heading"><AudioLines size={21} aria-hidden="true" /><h3 id="quick-voice">Głos</h3></div>
          <div className="row"><span>Czytaj odpowiedzi na głos</span><Toggle on={settings.speak} label="Czytaj odpowiedzi na głos" onClick={() => store.setSettings({ speak: !settings.speak })} /></div>
          <p className="muted">Mikrofon włączysz przyciskiem JARVIS-a. Silnik głosu i nasłuch ustawisz poniżej.</p>
          <button className="btn" onClick={() => onAdvanced("voice", "set-voice")}>Wybierz głos i mikrofon</button>
        </section>

        <section className="quick-settings-card" aria-labelledby="quick-look">
          <div className="quick-settings-heading"><Palette size={21} aria-hidden="true" /><h3 id="quick-look">Wygląd</h3></div>
          <InterfaceModeSwitch mode={settings.interfaceMode} onChange={(interfaceMode) => store.setSettings({ interfaceMode })} />
          <p className="quick-settings-description">Kolor PRO NEW</p>
          <div className="quick-settings-palette" role="group" aria-label="Kolor PRO NEW">
            {PALETTES.map(({ id, label }) => <button key={id} type="button" data-accent={id}
              className={`chip${(settings.proAccent || "violet") === id ? " is-active on" : ""}`}
              aria-pressed={(settings.proAccent || "violet") === id} onClick={() => store.setSettings({ proAccent: id })}>
              <span aria-hidden="true" />{label}
            </button>)}
          </div>
          <p className="muted">Ten sam JARVIS, Twoje rozmowy i zadania w obu układach.</p>
        </section>
      </div>
    </Modal>
  );
}
