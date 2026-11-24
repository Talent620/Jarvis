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
import {
  getSentinelState,
  resolveSentinelDecision,
  stopOmniSentinel,
  subscribeSentinel,
  type SentinelState,
} from "../lib/omniSentinel";

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
  const [sentinel, setSentinel] = useState<SentinelState>(() => getSentinelState());

  useEffect(() => {
    const offPilot = subscribeOmniPilot(setState);
    const offSentinel = subscribeSentinel(setSentinel);
    return () => {
      offPilot();
      offSentinel();
    };
  }, []);

  const sentinelActive = sentinel.status === "watching" || sentinel.status === "awaiting_decision";
  if (!state.visible && !sentinelActive) return null;

  const isSentinelDecision = sentinel.status === "awaiting_decision" && !!sentinel.hit;
  const meta = isSentinelDecision
    ? { label: "STRAŻNIK · DECYZJA", tone: "amber" as const }
    : !state.visible && sentinel.status === "watching"
      ? { label: "STRAŻNIK W TLE", tone: "cyan" as const }
      : PHASE_META[state.phase] || PHASE_META.idle;

  const recentSteps = state.visible ? state.steps.slice(-4) : [];
  const stageShot = isSentinelDecision ? sentinel.hit?.screenshotDataUrl : state.screenshotDataUrl;
  const reticle = isSentinelDecision && sentinel.hit
    ? {
        xNorm: sentinel.hit.xNorm,
        yNorm: sentinel.hit.yNorm,
        x: sentinel.hit.x,
        y: sentinel.hit.y,
        label: sentinel.hit.label,
        confidence: sentinel.hit.confidence,
        source: "vision" as const,
      }
    : state.reticle;

  return (
    <aside
      className={`omni-hud omni-tone-${meta.tone}`}
      role="status"
      aria-live="polite"
      aria-label="JARVIS OMNI-PILOT"
    >
      <div className="omni-hud-head">
        <div className="omni-hud-title">
          <span className={`omni-dot ${state.active || sentinelActive ? "pulse" : ""}`} aria-hidden="true" />
          <span className="omni-brand">OMNI-PILOT</span>
          <span className="omni-badge">{meta.label}</span>
          {state.visible && state.maxSteps > 1 && (
            <span className="omni-step-pill">
              {state.step}/{state.maxSteps}
            </span>
          )}
        </div>
        <div className="omni-hud-controls">
          {state.active || sentinelActive ? (
            <button
              type="button"
              className="omni-stop-btn"
              onClick={() => {
                abortOmniPilot();
                stopOmniSentinel();
              }}
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

      {sentinelActive && (
        <div className="omni-sentinel-bar">
          <div className="omni-sentinel-row">
            <span>👁 Strażnik: <strong>{sentinel.condition}</strong></span>
            <span className="omni-step-pill">
              {sentinel.checksDone}/{sentinel.maxChecks}
            </span>
          </div>
          <div className="omni-sentinel-meta">
            Statyczne klatki (0 USD): {sentinel.skippedStaticFrames} · Rozmowa KUMPEL aktywna równolegle
          </div>
        </div>
      )}

      {state.visible && state.goal && !isSentinelDecision && <div className="omni-goal">{state.goal}</div>}

      {stageShot && (
        <div className="omni-stage">
          <img
            src={stageShot}
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
                {reticle.source === "os-tree" ? "⚡ OS · " : ""}
                {reticle.label} · {Math.round(reticle.confidence * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {isSentinelDecision && sentinel.hit && (
        <div className="omni-confirm" role="alertdialog" aria-label="Decyzja Strażnika Ekranu">
          <div className="omni-confirm-text">👁 {sentinel.hit.question}</div>
          <div className="omni-sentinel-actions">
            <button type="button" className="omni-btn-allow" onClick={() => void resolveSentinelDecision("click")}>
              🎯 Kliknij
            </button>
            <button type="button" className="omni-btn-neutral" onClick={() => void resolveSentinelDecision("move")}>
              🖱 Wskaż
            </button>
            <button type="button" className="omni-btn-neutral" onClick={() => void resolveSentinelDecision("resume")}>
              ▶ Dalej
            </button>
            <button type="button" className="omni-btn-deny" onClick={() => void resolveSentinelDecision("stop")}>
              ⏹ Stop
            </button>
          </div>
        </div>
      )}

      {state.visible && state.statusMessage && !isSentinelDecision && (
        <div className="omni-status">{state.statusMessage}</div>
      )}

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
            {reticle.source === "os-tree" ? "AT-SPI2/UIA " : ""}
            px ({reticle.x}, {reticle.y})
          </span>
        )}
      </div>
    </aside>
  );
}
