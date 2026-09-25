// "Co robię" panel (mission M10): the runtime's own view of the current task (goal, step, target,
// environment, model, time, how it was verified) with PAUZA / WZNÓW / STOP and a diagnostics
// export. Presentation only: the view comes from statusView() over the kernel state, so the panel
// can never show more certainty than the runtime has.

import React, { useEffect, useState } from "react";
import type { StatusView } from "../lib/runtime/diagnostics";

const STATE_LABEL: Record<StatusView["state"], string> = {
  idle: "czekam na polecenie",
  running: "w trakcie",
  paused: "wstrzymane",
  waiting_consent: "czeka na twoją zgodę",
  blocked: "zablokowane",
  done: "zrobione",
  failed: "nie udało się",
  cancelled: "przerwane",
};

const TRUTH_LABEL: Record<string, string> = {
  CONFIRMED: "potwierdzone",
  ATTEMPTED: "próba bez odczytu",
  UNKNOWN_AFTER_ATTEMPT: "nie wiem, czy zadziałało",
  FAILED: "nie udało się",
  BLOCKED: "zablokowane",
  NEEDS_PERMISSION: "brak zgody systemu",
  NEEDS_HARDWARE: "brak sprzętu",
  NEEDS_CAPABILITY: "brak możliwości",
  SIMULATED: "symulacja",
  started: "w toku",
};

export const formatElapsed = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5 }}>
    <span style={{ color: "var(--muted, #8aa)", minWidth: 96, flexShrink: 0 }}>{label}</span>
    <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{children}</span>
  </div>
);

const btn: React.CSSProperties = { fontSize: 12, padding: "4px 12px", minHeight: 44, minWidth: 44, borderRadius: 8 };

interface Props {
  view: StatusView;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onExport?: () => void;
  onClose?: () => void;
}

export const RuntimeStatusPanel: React.FC<Props> = ({ view, onPause, onResume, onStop, onExport, onClose }) => (
  <section aria-label="Co robię" role="status" aria-live="polite" style={{ border: "1px solid var(--line, #234)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6, background: "var(--panel, #0b1620)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <strong style={{ fontSize: 14 }}>Co robię: {STATE_LABEL[view.state]}</strong>
      {onClose && <button type="button" aria-label="Zamknij panel" onClick={onClose} style={btn}>x</button>}
    </div>
    {view.goal && <Row label="Cel">{view.goal}</Row>}
    {view.step && <Row label="Krok">{view.step}{view.stepIndex && view.stepCount ? ` (${view.stepIndex} z ${view.stepCount})` : ""}</Row>}
    {view.target && <Row label="Na czym">{view.target}</Row>}
    <Row label="Gdzie">{view.environment}{view.place ? `, ${view.place}` : ""}</Row>
    {view.model && <Row label="Model">{view.model}</Row>}
    {typeof view.elapsedMs === "number" && <Row label="Czas">{formatElapsed(view.elapsedMs)}</Row>}
    {view.verification && <Row label="Sprawdzenie">{view.verification}</Row>}
    {view.pendingConsent && <Row label="Pytam o zgodę"><span style={{ color: "var(--gold, #d9a400)" }}>{view.pendingConsent}</span></Row>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" onClick={onPause} disabled={!view.canPause || !onPause} style={btn}>PAUZA</button>
      <button type="button" onClick={onResume} disabled={!view.canResume || !onResume} style={btn}>WZNÓW</button>
      <button type="button" onClick={onStop} disabled={!view.canStop || !onStop} style={btn}>STOP</button>
      {onExport && <button type="button" onClick={onExport} style={btn}>Eksport diagnostyki</button>}
    </div>
    {!!view.recent.length && (
      <ol aria-label="Ostatnie akcje" style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
        {view.recent.map((a, i) => (
          <li key={`${a.at}-${i}`}>
            {a.kind}: {TRUTH_LABEL[a.truth] ?? a.truth}{a.evidence ? `, ${a.evidence}` : ""}
          </li>
        ))}
      </ol>
    )}
  </section>
);

/** Save a diagnostics JSON through a download link (nothing is uploaded). */
export function downloadJson(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Desktop dock: follows the app runtime once it exists and re-renders on kernel changes. */
const RuntimeStatusDock: React.FC = () => {
  const [view, setView] = useState<StatusView | null>(null);
  const [open, setOpen] = useState(true);
  const [ctl, setCtl] = useState<import("../lib/runtime/appRuntime").AppRuntimeControls | null>(null);
  useEffect(() => {
    let off = () => undefined as void;
    let cancelled = false;
    void import("../lib/runtime/appRuntime").then(({ whenAppRuntime }) => {
      if (cancelled) return;
      off = whenAppRuntime((c) => {
        setCtl(c);
        setView(c.view());
        const unsub = c.subscribe(() => setView(c.view()));
        const tick = setInterval(() => setView(c.view()), 1000);
        return () => { unsub(); clearInterval(tick); };
      });
    });
    return () => { cancelled = true; off(); };
  }, []);
  if (!view || !ctl) return null;
  const active = view.state !== "idle" || view.recent.length > 0;
  if (!active) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...btn, position: "fixed", right: 16, bottom: 88, zIndex: 40 }}>
        Co robię: {STATE_LABEL[view.state]}
      </button>
    );
  }
  return (
    <div style={{ position: "fixed", right: 16, bottom: 88, width: "min(380px, calc(100vw - 32px))", zIndex: 40 }}>
      <RuntimeStatusPanel
        view={view}
        onPause={() => ctl.press("pause")}
        onResume={() => ctl.press("resume")}
        onStop={() => ctl.press("stop")}
        onExport={() => downloadJson(`jarvis-diagnostyka-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, ctl.diagnostics())}
        onClose={() => setOpen(false)}
      />
    </div>
  );
};

export default RuntimeStatusDock;
