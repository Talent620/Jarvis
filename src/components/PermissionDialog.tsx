import { useEffect, useRef, useState } from "react";
import type { ConsentRequest } from "../lib/permissions";
import { createListener, isSpeechSupported, speak, stopSpeaking, type VoiceListener } from "../lib/voice";
import { feedback } from "../lib/feedback";
import { store } from "../lib/store";

const LABELS: Record<string, string> = {
  make_call: "Zadzwonić",
  send_sms: "Wysłać SMS",
  call_contact: "Zadzwonić do kontaktu",
  text_contact: "Wysłać SMS do kontaktu",
  smart_home: "Sterować urządzeniem smart home",
  run_scene: "Uruchomić scenę",
  open_service: "Otworzyć aplikację/usługę",
  navigate_to: "Uruchomić nawigację",
  add_task: "Dodać zadanie",
  add_note: "Zapisać notatkę",
  add_reminder: "Ustawić przypomnienie",
  add_shopping_item: "Dodać do listy zakupów",
  add_calendar_event: "Dodać wydarzenie do kalendarza",
  remember_fact: "Zapamiętać informację o Tobie",
  create_scene: "Zapisać scenę",
  complete_task: "Oznaczyć zadanie jako zrobione",
};

export default function PermissionDialog({
  req,
  onDecision,
}: {
  req: ConsentRequest;
  onDecision: (allow: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const [listening, setListening] = useState(false);
  const rememberRef = useRef(false);
  rememberRef.current = remember;
  // Współdzielona blokada: i głos, i kliknięcie przycisku idą przez nią, więc
  // onDecision nie odpali się dwa razy (wyścig głos ↔ przycisk).
  const decidedRef = useRef(false);
  const finish = (allow: boolean, rememberFlag: boolean) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    onDecision(allow, rememberFlag);
  };
  const label = LABELS[req.tool] ?? req.tool;
  const summary = JSON.stringify(req.input ?? {}, null, 0).slice(0, 200);

  // Potwierdzanie głosem: JARVIS pyta i nasłuchuje „tak"/„nie".
  useEffect(() => {
    feedback("tap");
    if (!store.settings.voiceConfirm || !isSpeechSupported()) return;
    let decided = false;
    let listener: VoiceListener | null = null;
    const decide = (allow: boolean) => {
      if (decided) return;
      decided = true;
      listener?.stop();
      stopSpeaking();
      finish(allow, rememberRef.current);
    };
    speak(`${label}? Powiedz tak albo nie.`, { ...store.settings, speak: true });
    listener = createListener({
      wakeWord: false,
      onError: () => {
        // Głos niedostępny (np. brak klucza Groq na desktopie) — zostaw decyzję ręczną.
        decided = true; // blokuje auto-restart w onEnd; przyciski wciąż działają
        setListening(false);
      },
      onFinal: (t) => {
        const v = t.toLowerCase();
        if (/\b(tak|zezw|potwierdz|wy[śs]lij|dzwo[nń]|dawaj|okej|\bok\b|zgoda|jasne|r[oó]b|zr[oó]b|prosz[eę]|śmiało|smialo)\b/.test(v)) decide(true);
        else if (/\b(nie|odm[oó]w|anuluj|stop|przerwij|zostaw|zaniechaj)\b/.test(v)) decide(false);
        else listener?.start(); // niezrozumiałe — słuchaj dalej
      },
      onEnd: () => {
        if (!decided) listener?.start();
      },
    });
    setListening(true);
    listener.start();
    return () => {
      decided = true;
      listener?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet" style={{ zIndex: 60 }}>
      <div className="panel" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <div className="grabber" />
          <h2>🔐 Zgoda na akcję</h2>
        </div>
        <div className="panel-body">
          <p style={{ fontSize: 17, margin: "4px 0 10px" }}>
            JARVIS chce: <b style={{ color: "var(--gold)" }}>{label}</b>
            {req.risk === "outbound" && <span className="muted"> · akcja zewnętrzna</span>}
          </p>
          {summary !== "{}" && (
            <pre
              style={{
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 10,
                fontSize: 12,
                color: "var(--text-dim)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {summary}
            </pre>
          )}
          {listening && (
            <p className="muted" style={{ margin: "0 0 8px" }}>
              🎙 Powiedz „<b>tak</b>" albo „<b>nie</b>" — lub użyj przycisków.
            </p>
          )}
          <label className="row" style={{ cursor: "pointer" }}>
            <span>Zapamiętaj zgodę dla tej akcji</span>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              style={{ width: 20, height: 20 }}
            />
          </label>
        </div>
        <div className="panel-foot" style={{ display: "flex", gap: 8 }}>
          <button className="btn" style={{ flex: 1 }} onClick={() => finish(false, false)}>
            Odmów
          </button>
          <button className="btn primary" style={{ flex: 1 }} onClick={() => finish(true, remember)}>
            Zezwól
          </button>
        </div>
      </div>
    </div>
  );
}
