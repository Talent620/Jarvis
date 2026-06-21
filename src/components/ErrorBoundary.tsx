import { Component, type ErrorInfo, type ReactNode } from "react";
import { toast } from "../lib/toast";
import { logError } from "../lib/errorLog";

// Samoleczenie interfejsu: crash renderu nie wywala całej aplikacji.
// Boundary przechwytuje błąd, automatycznie restartuje poddrzewo (remount przez
// zmianę key) i mówi o tym po ludzku. Po wyczerpaniu prób — czytelny ekran
// z przyciskiem ponownego uruchomienia ORAZ szczegółami (diagnoza), zamiast białej strony.
const MAX_AUTO_RESTARTS = 2;

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null; info: string; restarts: number; epoch: number };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "", restarts: 0, epoch: 0 };
  private lastCrashAt = 0;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[JARVIS] moduł uległ awarii:", error, errorInfo);
    // Diagnostyka: zapisz do lokalnego logu (widoczne w ⚙ → diagnostyka / Umysł) i zachowaj do podglądu.
    try { logError(`ui:${this.props.label || "render"}`, error, (errorInfo.componentStack || "").split("\n").slice(1, 3).join(" ").trim().slice(0, 160)); } catch { /* ignore */ }
    const stack = `${error?.name || "Error"}: ${error?.message || ""}\n${(errorInfo.componentStack || "").trim().split("\n").slice(0, 4).join("\n")}`;
    // Decay: po ≥60 s stabilnego renderu traktuj kolejną awarię jak świeżą (zeruj licznik),
    // by jednorazowy crash sprzed godziny nie blokował samoleczenia na stałe.
    const now = Date.now();
    const restarts = now - this.lastCrashAt > 60_000 ? 0 : this.state.restarts;
    this.lastCrashAt = now;
    if (restarts < MAX_AUTO_RESTARTS) {
      setTimeout(() => {
        toast(`Napotkałem problem z modułem ${this.props.label || "interfejsu"} — zrestartowałem go ✓`);
        this.setState((s) => ({ error: null, info: stack, restarts: restarts + 1, epoch: s.epoch + 1 }));
      }, 60);
    } else {
      this.setState({ info: stack, restarts });
    }
  }

  render() {
    if (this.state.error && this.state.restarts >= MAX_AUTO_RESTARTS) {
      const details = this.state.info || `${this.state.error.name}: ${this.state.error.message}`;
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
          <details style={{ maxWidth: 360, width: "100%", textAlign: "left", marginTop: 4 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-dim)" }}>Pokaż szczegóły (dla diagnozy)</summary>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11, marginTop: 6, color: "var(--text-dim)" }}>{details}</pre>
            <button className="btn" style={{ width: "auto", padding: "5px 12px", fontSize: 12 }} onClick={() => { void navigator.clipboard?.writeText(details).catch(() => {}); toast("Skopiowano szczegóły ✓"); }}>
              📋 Kopiuj szczegóły
            </button>
          </details>
        </div>
      );
    }
    if (this.state.error) return null; // jedna pusta klatka podczas auto-restartu
    return <div key={this.state.epoch} style={{ display: "contents" }}>{this.props.children}</div>;
  }
}
