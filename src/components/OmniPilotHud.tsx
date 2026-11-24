import { useEffect, useState } from "react";
import {
  abortOmniPilot,
  dismissOmniHud,
  getOmniHudState,
  respondOmniConfirm,
  subscribeOmniPilot,
  type OmniHudState,
  type OmniPhase,
} from "../lib/omniPilot";

const PHASE_META: Record<OmniPhase, { label: string; tone: "cyan" | "green" | "amber" | "red" }> = {
  idle: { label: "GOTOWY", tone: "cyan" },
  reflex: { label: "REFLEKS <30ms", tone: "cyan" },
  observing: { label: "OBSERWACJA", tone: "cyan" },
  grounding: { label: "NAMIERZANIE", tone: "cyan" },
  moving: { label: "RUCH KURSORA", tone: "cyan" },
  acting: { label: "WYKONYWANIE", tone: "cyan" },
  confirm: { label: "ZGODA RISKGUARD", tone: "amber" },
  verifying: { label: "WERYFIKACJA", tone: "cyan" },
  done: { label: "WYKONANO", tone: "green" },
  need_human: { label: "POTRZEBNY CZŁOWIEK", tone: "amber" },
  blocked: { label: "ZABLOKOWANO", tone: "red" },
  aborted: { label: "ZATRZYMANO", tone: "red" },
  error: { label: "BŁĄD", tone: "red" },
};

export function OmniPilotHud() {
  const [state, setState] = useState<OmniHudState>(() => getOmniHudState());

  useEffect(() => {
    return subscribeOmniPilot(setState);
  }, []);

  if (!state.visible) return null;

  const meta = PHASE_META[state.phase] || PHASE_META.idle;
  const recentSteps = state.steps.slice(-4);
  const reticle = state.reticle;

  return (
    <aside
      className={`omni-hud omni-tone-${meta.tone}`}
      role="status"
      aria-live="polite"
      aria-label="JARVIS OMNI-PILOT"
    >
      <div className="omni-hud-head">
        <div className="omni-hud-title">
          <span className={`omni-dot ${state.active ? "pulse" : ""}`} aria-hidden="true" />
          <span className="omni-brand">OMNI-PILOT</span>
          <span className="omni-badge">{meta.label}</span>
          {state.maxSteps > 1 && (
            <span className="omni-step-pill">
              {state.step}/{state.maxSteps}
            </span>
          )}
        </div>
        <div className="omni-hud-controls">
          {state.active ? (
            <button
              type="button"
              className="omni-stop-btn"
              onClick={() => abortOmniPilot()}
              title="Natychmiastowe zatrzymanie awaryjne (Ctrl+Alt+X)"
            >
              ⏹ STOP
            </button>
          ) : (
            <button
              type="button"
              className="omni-close-btn"
              onClick={() => dismissOmniHud()}
              aria-label="Zamknij panel OMNI-PILOT"
              title="Zamknij"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {state.goal && <div className="omni-goal">{state.goal}</div>}

      {state.screenshotDataUrl && (
        <div className="omni-stage">
          <img
            src={state.screenshotDataUrl}
            alt="Podgląd analizy wizyjnej pulpitu"
            className="omni-shot"
          />
          {reticle && (
            <div
              className="omni-reticle"
              style={{
                left: `${Math.max(2, Math.min(98, reticle.xNorm / 10))}%`,
                top: `${Math.max(4, Math.min(96, reticle.yNorm / 10))}%`,
              }}
              aria-label={`Cel wizyjny: ${reticle.label}`}
            >
              <span className="omni-reticle-ring" />
              <span className="omni-reticle-core" />
              <span className="omni-reticle-tag">
                {reticle.label} · {Math.round(reticle.confidence * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {state.statusMessage && <div className="omni-status">{state.statusMessage}</div>}

      {state.confirmRequest && (
        <div className="omni-confirm" role="alertdialog" aria-label="Potwierdzenie RiskGuard">
          <div className="omni-confirm-text">🛡️ {state.confirmRequest.reason}</div>
          <div className="omni-confirm-actions">
            <button
              type="button"
              className="omni-btn-allow"
              onClick={() => respondOmniConfirm(true)}
            >
              ✓ Potwierdź
            </button>
            <button
              type="button"
              className="omni-btn-deny"
              onClick={() => respondOmniConfirm(false)}
            >
              ✕ Odrzuć
            </button>
          </div>
        </div>
      )}

      {recentSteps.length > 0 && (
        <ul className="omni-log">
          {recentSteps.map((s, idx) => (
            <li key={`${s.ts}-${idx}`} className={s.ok ? "ok" : "warn"}>
              <span className="omni-log-ic">{s.ok ? "•" : "!"}</span>
              <span className="omni-log-tx">{s.summary}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="omni-foot">
        <span>Kill-Switch: Ctrl+Alt+X</span>
        {reticle && (
          <span>
            px ({reticle.x}, {reticle.y})
          </span>
        )}
      </div>
    </aside>
  );
}
