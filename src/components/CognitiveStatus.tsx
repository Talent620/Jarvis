// === Panel „Co JARVIS robi i dlaczego" (CognitiveStatus) ===
// Lekki, czytelny na S9. Renderuje WYŁĄCZNIE zredagowany model z cognitiveStatus.ts — bez
// chain-of-thought, bez kluczy, promptów i podpisów myślenia. Daje też przycisk zatrzymania celu.
// Cała logika i redakcja są w czystym buildCognitiveStatus (testowane); tu tylko prezentacja.

import React from "react";
import type { CognitiveStatusView } from "../lib/cognitiveStatus";

interface Props {
  view: CognitiveStatusView;
  onStop?: () => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5 }}>
    <span style={{ color: "var(--muted, #8aa)", minWidth: 96, flexShrink: 0 }}>{label}</span>
    <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{children}</span>
  </div>
);

const CognitiveStatus: React.FC<Props> = ({ view, onStop }) => {
  const idle = !view.goal && !view.currentStep && !view.tools.length;
  return (
    <div style={{ border: "1px solid var(--line, #234)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 14 }}>🧠 Co teraz robię i dlaczego</strong>
        {view.canStop && onStop && (
          <button type="button" onClick={onStop} style={{ fontSize: 12, padding: "4px 10px", minHeight: 44, minWidth: 44, borderRadius: 8 }}>
            ⏹ Zatrzymaj
          </button>
        )}
      </div>

      {idle && <span style={{ fontSize: 13, color: "var(--muted, #8aa)" }}>Bezczynny — czekam na zadanie.</span>}

      {view.goal && (
        <>
          <Row label="Cel">{view.goal.text}</Row>
          <Row label="Status">{view.goal.statusLabel} · {view.goal.progress}</Row>
        </>
      )}
      {view.currentStep && <Row label="Krok">{view.currentStep}</Row>}
      {(view.provider || view.model) && <Row label="Model">{[view.provider, view.model].filter(Boolean).join(" · ")}</Row>}
      {!!view.sources.length && <Row label="Źródła">{view.sources.join(", ")}</Row>}
      {!!view.tools.length && <Row label="Narzędzia">{view.tools.join(", ")}</Row>}
      {!!view.pendingConsents.length && (
        <Row label="Czeka na zgodę">
          <span style={{ color: "var(--gold, #d9a400)" }}>{view.pendingConsents.join(", ")}</span>
        </Row>
      )}
      {typeof view.confidence === "number" && <Row label="Pewność">{Math.round(view.confidence * 100)}%</Row>}
      {(typeof view.tokens === "number" || typeof view.cost === "number") && (
        <Row label="Koszt">
          {typeof view.tokens === "number" ? `${view.tokens} tok.` : ""}
          {typeof view.cost === "number" ? ` · ${view.cost} zł` : ""}
        </Row>
      )}
      {view.lastConfirmed && <Row label="Ostatnio potwierdzone">✅ {view.lastConfirmed}</Row>}
    </div>
  );
};

export default CognitiveStatus;
