import { useEffect, useRef, useState } from "react";
import { ConversationLoop, type LoopState } from "../lib/voiceLoop";
import { speak, stopSpeaking } from "../lib/voice";
import { store } from "../lib/store";
import { keepAwake, releaseAwake } from "../lib/wakeLock";
import { subscribeLevel } from "../lib/audioLevel";
import { useEscape } from "../hooks/useEscape";
import { ROBOT_VOICE, BOSS_GREETING } from "../lib/boss";

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
  const coreRef = useRef<HTMLDivElement>(null);

  // Rdzeń pulsuje w rytm głosu.
  useEffect(() => subscribeLevel((v) => {
    const el = coreRef.current;
    if (el) el.style.transform = `scale(${(1 + v * 0.6).toFixed(3)})`;
  }), []);

  useEffect(() => {
    let cancelled = false;
    const loop = new ConversationLoop(
      (s, d) => { if (!cancelled) { setState(s); if (d) setDetail(d); } },
      (t) => { if (!cancelled) setCaption(t); },
      ROBOT_VOICE,
    );
    void (async () => {
      await keepAwake().catch(() => {});
      try { await speak(BOSS_GREETING, { ...store.settings, speak: true, ...ROBOT_VOICE }); } catch { /* brak głosu — trudno */ }
      if (!cancelled) loop.start();
    })();
    return () => { cancelled = true; loop.stop(); stopSpeaking(); releaseAwake(); };
  }, []);

  return (
    <div className="sheet bossmode" onClick={(e) => e.stopPropagation()}>
      <div className="bossmode-inner">
        <div className="bossmode-title">⬢ TRYB SZEFA</div>
        <div className="bossmode-sub">AGENT GŁOSOWY · ROZUMIEM I WYKONUJĘ ROZKAZY</div>
        <div className="bossmode-core" ref={coreRef} data-state={state} />
        <div className="bossmode-state">{LABEL[state] || state}</div>
        {detail && <div style={{ fontSize: 12, color: "#6bff9e", maxWidth: 360 }}>{detail}</div>}
        <div className="bossmode-caption" aria-live="polite">{caption}</div>
        <div className="bossmode-hint">Mów wprost: „dodaj zadanie…”, „wyślij maila do…”, „znajdź…”, „zaplanuj…”. Akcje nieodwracalne potwierdzę głosem.</div>
        <button className="btn" style={{ maxWidth: 220, marginTop: 22 }} onClick={onClose}>■ Zakończ</button>
      </div>
    </div>
  );
}
