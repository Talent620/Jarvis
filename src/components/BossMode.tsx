import { useEffect, useRef, useState } from "react";
import { ConversationLoop, type LoopState } from "../lib/voiceLoop";
import { speak, stopSpeaking } from "../lib/voice";
import { store } from "../lib/store";
import { keepAwake, releaseAwake } from "../lib/wakeLock";
import { subscribeLevel } from "../lib/audioLevel";
import { setAutoConsent } from "../lib/permissions";
import { useEscape } from "../hooks/useEscape";
import { ROBOT_VOICE, BOSS_GREETING, bossSystem, bossQuickActions } from "../lib/boss";
import { jarvisBriefing } from "../lib/capabilities";
import { bossMemoryDigest } from "../lib/bossMemory";
import { hasUsableBrain } from "../lib/brain";
import { loadLiveThread, saveLiveThread, clearLiveThread, BOSS_THREAD_KEY } from "../lib/liveThread";
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
  const [input, setInput] = useState(""); // tor tekstowy (fallback, gdy mowa zawiedzie)
  const coreRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<ConversationLoop | null>(null);
  const lastErrRef = useRef(""); // nie powtarzaj w kółko tego samego błędu głosem
  const lastReplyRef = useRef(""); // ostatnia odpowiedź Szefa — do „🔁 Powtórz" (hands-free)
  const [canRepeat, setCanRepeat] = useState(false);

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
    const persona = [bossSystem(fullAccess, store.settings.userName), jarvisBriefing(), bossMemoryDigest()].filter(Boolean).join("\n\n");
    const prefer = brain ? { provider: brain.provider as ProviderId, model: brain.model } : undefined;
    const loop = new ConversationLoop(
      (s, d) => {
        if (cancelled) return;
        setState(s);
        if (d) setDetail(d);
        // Niezawodność: błąd ZAWSZE wypowiedz (Szef hands-free nie może milczeć), ale raz.
        if (s !== "error") { lastErrRef.current = ""; return; }
        if (d && d !== lastErrRef.current) {
          lastErrRef.current = d;
          void speak(d, { ...store.settings, speak: true, ...ROBOT_VOICE }).catch(() => {});
        }
      },
      (t) => {
        if (cancelled) return;
        setCaption(t);
        // Plan tylko z wypowiedzi Szefa (nie z „🗣 …” użytkownika). Odhaczanie wg „Krok N”.
        if (!t.startsWith("🗣")) {
          lastReplyRef.current = t; setCanRepeat(true); // zapamiętaj do „🔁 Powtórz"
          saveLiveThread(loopRef.current?.getHistory() || [], Date.now(), BOSS_THREAD_KEY); // ciągłość Szefa
          const p = parsePlan(t);
          if (p.length >= 2) { setPlan(p); setStep(0); }
          const cs = currentStep(t);
          if (cs) setStep(cs);
        }
      },
      ROBOT_VOICE,
      persona,
      prefer,
      { verify: true, captureDecisions: true, stallMs: 9000, insight: true },
    );
    loopRef.current = loop;
    void (async () => {
      await keepAwake().catch(() => {});
      // Niezawodność: bez mózgu nie udawaj, że działasz — powiedz wprost i pokieruj.
      if (!hasUsableBrain()) {
        const m = "Nie mam jeszcze mózgu. Dodaj darmowy klucz w ustawieniach, w sekcji AI — np. Gemini. Możesz też włączyć Tryb darmowy.";
        if (!cancelled) { setState("error"); setCaption(m); setDetail("⚙ → AI: wklej darmowy klucz (Gemini/Groq) albo włącz 🆓 Tryb darmowy."); }
        try { await speak(m, { ...store.settings, speak: true, ...ROBOT_VOICE }); } catch { /* brak głosu */ }
        return;
      }
      // Ciągłość: jeśli zadanie/rozmowa Szefa była niedawno, wznów kontekst.
      const prior = loadLiveThread(Date.now(), BOSS_THREAD_KEY);
      if (prior.length) { loop.seedHistory(prior); if (!cancelled) setDetail("↩ Wznawiam — pamiętam nasze ostatnie zadanie."); }
      try { await speak(BOSS_GREETING, { ...store.settings, speak: true, ...ROBOT_VOICE }); } catch { /* brak głosu — trudno */ }
      if (!cancelled) loop.start();
    })();
    return () => { cancelled = true; loop.stop(); stopSpeaking(); releaseAwake(); setAutoConsent(false); loopRef.current = null; };
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

        {/* Szybkie rozkazy do jednego dotknięcia — niezawodne (zero przesłyszeń) i pokazują, co można. */}
        {state !== "speaking" && state !== "thinking" && plan.length === 0 && (
          <div className="chips" style={{ flexWrap: "wrap", justifyContent: "center", marginTop: 8, gap: 6 }}>
            {bossQuickActions(new Date().getHours(), (store.data.tasks || []).filter((t) => !t.done).length).map((a) => (
              <button
                key={a.label}
                className="chip"
                onClick={() => {
                  if (a.command.trim().endsWith(":")) { setInput(a.command); return; } // dokończ wpisanie (np. „Dodaj zadanie: ")
                  setCaption("🗣 " + a.label);
                  loopRef.current?.say(a.command);
                }}
                title={a.command}
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        )}

        {/* Tor tekstowy — niezawodny fallback, gdy mowa zawiedzie albo wolisz pisać. */}
        <div className="bossmode-type">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { const t = input.trim(); if (t) { setInput(""); loopRef.current?.say(t); } } }}
            placeholder="…albo wpisz rozkaz i Enter"
            aria-label="Wpisz rozkaz dla Szefa"
          />
          <button className="chip" onClick={() => { const t = input.trim(); if (t) { setInput(""); loopRef.current?.say(t); } }}>Wyślij</button>
        </div>

        {canRepeat && state !== "speaking" && (
          <div className="chips" style={{ justifyContent: "center", marginTop: 10, gap: 6 }}>
            <button
              className="chip"
              onClick={() => { stopSpeaking(); void speak(lastReplyRef.current, { ...store.settings, speak: true, ...ROBOT_VOICE }).catch(() => {}); }}
              title="Powtórz ostatnią odpowiedź na głos"
            >
              🔁 Powtórz
            </button>
            <button
              className="chip"
              onClick={() => { loopRef.current?.resetHistory(); clearLiveThread(BOSS_THREAD_KEY); setPlan([]); setStep(0); setCanRepeat(false); setDetail(""); setCaption("Nowy temat. Słucham rozkazów."); }}
              title="Zacznij nowy temat (wyczyść kontekst rozmowy)"
            >
              🆕 Nowy temat
            </button>
          </div>
        )}

        <button className="btn" style={{ maxWidth: 220, marginTop: 18 }} onClick={onClose}>■ Zakończ</button>
      </div>
    </div>
  );
}
