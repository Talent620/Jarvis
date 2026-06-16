import { Component, type ReactNode } from "react";
import { toast } from "../lib/toast";

// Samoleczenie interfejsu: crash renderu nie wywala całej aplikacji.
// Boundary przechwytuje błąd, automatycznie restartuje poddrzewo (remount przez
// zmianę key) i mówi o tym po ludzku. Po wyczerpaniu prób — czytelny ekran
// z przyciskiem ponownego uruchomienia, zamiast białej strony.
const MAX_AUTO_RESTARTS = 2;

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null; restarts: number; epoch: number };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, restarts: 0, epoch: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error("[JARVIS] moduł uległ awarii:", error);
    if (this.state.restarts < MAX_AUTO_RESTARTS) {
      // Auto-restart: zdejmij błąd i przemontuj poddrzewo w następnej klatce.
      setTimeout(() => {
        toast(`Napotkałem problem z modułem ${this.props.label || "interfejsu"} — zrestartowałem go ✓`);
        this.setState((s) => ({ error: null, restarts: s.restarts + 1, epoch: s.epoch + 1 }));
      }, 60);
    }
  }

  render() {
    if (this.state.error && this.state.restarts >= MAX_AUTO_RESTARTS) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 12, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>🛠</div>
          <h2 style={{ margin: 0 }}>Moduł wymaga ponownego uruchomienia</h2>
          <p className="muted" style={{ maxWidth: 360 }}>
            Próbowałem przywrócić go automatycznie, ale problem wraca. Twoje dane są
            bezpieczne — zapisuję wszystko na bieżąco.
          </p>
          <button className="btn primary" style={{ width: "auto" }} onClick={() => window.location.reload()}>
            🔄 Uruchom ponownie JARVIS
          </button>
        </div>
      );
    }
    if (this.state.error) return null; // jedna pusta klatka podczas auto-restartu
    return <div key={this.state.epoch} style={{ display: "contents" }}>{this.props.children}</div>;
  }
}
