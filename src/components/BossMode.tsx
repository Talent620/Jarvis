import { useEffect, useRef, useState } from "react";
import { ConversationLoop, type LoopState } from "../lib/voiceLoop";
import { speak, stopSpeaking } from "../lib/voice";
import { store } from "../lib/store";
import { keepAwake, releaseAwake } from "../lib/wakeLock";
import { subscribeLevel } from "../lib/audioLevel";
import { setAutoConsent } from "../lib/permissions";
import { useEscape } from "../hooks/useEscape";
import { ROBOT_VOICE, BOSS_GREETING, bossSystem } from "../lib/boss";
import { jarvisBriefing } from "../lib/capabilities";
import { parsePlan, currentStep } from "../lib/agentPlan";
import { bestBrain, bestFreeBrain } from "../lib/league";
import { loadIqResults } from "../lib/iqProbe";
import { PROVIDER_LIST, PROVIDERS } from "../lib/providers/registry";
import type { ProviderId } from "../lib/providers/types";

const LABEL: Record<LoopState, string> = {
  listening: "NASŁUCH…",
  thinking: "PRZETWARZAM…",
  speaking: "WYKONUJĘ…",
  error: "BŁĄD",
  closed: "KONIEC",
};

/**
 * ⬢ Tryb Szefa — pełnoekranowy agent głosowy (Matrix + głos robota). Reużywa pętli
 * rozmowy (ConversationLoop → askJarvis → narzędzia), więc rozumie i WYKONUJE rozkazy
 * dowolnym skonfigurowanym modelem. Akcje nieodwracalne i tak proszą o potwierdzenie.
 */
export default function BossMode({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [state, setState] = useState<LoopState>("listening");
  const [caption, setCaption] = useState("Tryb Szefa online. Wydaj rozkaz głosem.");
  const [detail, setDetail] = useState("");
  const [plan, setPlan] = useState<string[]>([]); // tryb agenta wielokrokowego
  const [step, setStep] = useState(0); // który krok trwa (1-indeks)
  const coreRef = useRef<HTMLDivElement>(null);

  // Rdzeń pulsuje w rytm głosu.
  useEffect(() => subscribeLevel((v) => {
    const el = coreRef.current;
    if (el) el.style.transform = `scale(${(1 + v * 0.6).toFixed(3)})`;
  }), []);

  const fullAccess = !!store.settings.bossFullAccess;
  // Auto-router: najmocniejszy GOTOWY mózg (zmierzony Ligą, inaczej orientacyjny).
  const brain = (() => {
    const ready = (id: ProviderId) => (id === "ollama" ? !!store.settings.ollamaUrl?.trim() : !!store.settings.keys[id]?.trim());
    const inputs = PROVIDER_LIST.filter((p) => p.id !== "ollama").map((p) => ({ provider: p.id, model: p.defaultModel, label: p.label, ready: ready(p.id) }));
    return store.settings.freeMode ? bestFreeBrain(inputs, loadIqResults()) : bestBrain(inputs, loadIqResults());
  })();
  const brainLabel = brain ? `${PROVIDERS[brain.provider as ProviderId]?.label || brain.provider}` : "auto";

  useEffect(() => {
    let cancelled = false;
    // PEŁNY DOSTĘP tylko przez czas otwartego Trybu Szefa — zdejmujemy przy zamknięciu.
    if (fullAccess) setAutoConsent(true);
    const persona = `${bossSystem(fullAccess, store.settings.userName)}\n\n${jarvisBriefing()}`;
    const prefer = brain ? { provider: brain.provider as ProviderId, model: brain.model } : undefined;
    const loop = new ConversationLoop(
      (s, d) => { if (!cancelled) { setState(s); if (d) setDetail(d); } },
      (t) => {
        if (cancelled) return;
        setCaption(t);
        // Plan tylko z wypowiedzi Szefa (nie z „🗣 …" użytkownika). Odhaczanie wg „Krok N".
        if (!t.startsWith("🗣")) {
          const p = parsePlan(t);
          if (p.length >= 2) { setPlan(p); setStep(0); }
          const cs = currentStep(t);
          if (cs) setStep(cs);
        }
      },
      ROBOT_VOICE,
      persona,
      prefer,
    );
    void (async () => {
      await keepAwake().catch(() => {});
      try { await speak(BOSS_GREETING, { ...store.settings, speak: true, ...ROBOT_VOICE }); } catch { /* brak głosu — trudno */ }
      if (!cancelled) loop.start();
    })();
    return () => { cancelled = true; loop.stop(); stopSpeaking(); releaseAwake(); setAutoConsent(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet bossmode" onClick={(e) => e.stopPropagation()}>
      <div className="bossmode-inner">
        <div className="bossmode-title">⬢ TRYB SZEFA</div>
        <div className="bossmode-sub">AGENT GŁOSOWY · ROZUMIEM I WYKONUJĘ ROZKAZY</div>
        <div className="bossmode-access" data-full={fullAccess}>
          {fullAccess ? "🟢 PEŁNY DOSTĘP — przewiduję i potwierdzam głosem" : "🔒 Tryb bezpieczny — pełny dostęp w ⚙ → Tryb Szefa"}
        </div>
        <div className="bossmode-sub" style={{ marginTop: 4 }}>🧠 MÓZG: {brainLabel}</div>
        <div className="bossmode-core" ref={coreRef} data-state={state} />
        <div className="bossmode-state">{LABEL[state] || state}</div>
        {detail && <div style={{ fontSize: 12, color: "#6bff9e", maxWidth: 360 }}>{detail}</div>}
        {plan.length > 0 && (
          <div className="bossmode-plan">
            {plan.map((s, i) => {
              const done = step > 0 && i + 1 < step;
              const active = step > 0 && i + 1 === step;
              return (
                <div key={i} className="bossmode-step" data-active={active} data-done={done}>
                  <span style={{ width: 18, display: "inline-block" }}>{done ? "✅" : active ? "▶" : "▢"}</span> {s}
                </div>
              );
            })}
          </div>
        )}
        <div className="bossmode-caption" aria-live="polite">{caption}</div>
        <div className="bossmode-hint">Mów wprost: „dodaj zadanie…”, „wyślij maila do…”, „znajdź…”, „zaplanuj…”. Akcje nieodwracalne potwierdzę głosem.</div>
        <button className="btn" style={{ maxWidth: 220, marginTop: 22 }} onClick={onClose}>■ Zakończ</button>
      </div>
    </div>
  );
}
