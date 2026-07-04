import { useState } from "react";
import {
  guideQuestion, guideAdvice, guideSuggestions, applyAnswer, nextStepId, guideProgress,
  isSkippable, guideToBrief, suggestKind, suggestStyle, labelKind, labelStyle,
  type GuideAnswers, type GuideStepId,
} from "../lib/webGuide";
import type { SiteKind, SiteStyle, ClientBrief } from "../lib/webgen";

// 💬 Przewodnik budowy strony — rozmowa krok po kroku. Zadaje jedno pytanie, doradza, podpowiada
// dopasowane odpowiedzi, a na końcu składa gotowy brief + typ + styl i oddaje do budowy.
// Cała logika toru jest w webGuide (pure); tu tylko widok. Ephemeralny (żyje w panelu Kreatora).
export default function WebGuide({ onComplete, onCancel }: {
  onComplete: (brief: ClientBrief, kind: SiteKind, style: SiteStyle) => void;
  onCancel: () => void;
}) {
  const [answers, setAnswers] = useState<GuideAnswers>({});
  const [step, setStep] = useState<GuideStepId>("business");
  const [input, setInput] = useState("");

  const prog = guideProgress(step);
  const chips = guideSuggestions(step, answers);

  const advance = (value: string) => {
    const a = applyAnswer(answers, step, value);
    setAnswers(a);
    setInput("");
    setStep(nextStepId(step));
  };
  const finish = () => {
    onComplete(guideToBrief(answers), (answers.kind || suggestKind(answers)) as SiteKind, (answers.style || suggestStyle(answers)) as SiteStyle);
  };

  return (
    <div className="journal-card" style={{ padding: "12px 14px", marginTop: 8 }}>
      {/* Pasek postępu rozmowy */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>💬 Zbuduj z JARVISEM</span>
        <button className="chip" style={{ fontSize: 11 }} onClick={onCancel}>✕ Zamknij</button>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--line, rgba(128,128,128,.2))", overflow: "hidden", marginBottom: 10 }}>
        <div style={{ width: `${Math.round((prog.index / prog.total) * 100)}%`, height: "100%", background: "var(--cyan, #6ce7ff)", transition: "width .3s" }} />
      </div>

      {step !== "done" ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{guideQuestion(step)}</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.4 }}>💡 {guideAdvice(step, answers)}</div>

          {chips.length > 0 && (
            <div className="chips" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {chips.map((c) => (
                <button key={c.value} className="chip" style={{ fontSize: 12 }} onClick={() => advance(c.value)}>{c.label}</button>
              ))}
            </div>
          )}

          <textarea
            className="ta"
            style={{ minHeight: 46 }}
            value={input}
            placeholder={step === "sections" ? "Zostaw puste, by użyć proponowanych, albo wypisz swoje…" : "Wpisz odpowiedź…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) advance(input); }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => advance(input)}>
              {input.trim() ? "Dalej →" : chips.length ? "Wybierz albo wpisz" : "Dalej →"}
            </button>
            {isSkippable(step) && !input.trim() && (
              <button className="btn" style={{ width: "auto" }} onClick={() => advance("")}>Pomiń</button>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{guideQuestion("done")}</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>
            {answers.business && <div>🏢 <b>{answers.business}</b>{answers.industry ? ` — ${answers.industry}` : ""}</div>}
            {answers.goal && <div>🎯 Cel: {answers.goal}</div>}
            {answers.audience && <div>👥 Odbiorcy: {answers.audience}</div>}
            <div>🧩 Typ: {labelKind((answers.kind || suggestKind(answers)) as SiteKind)} · Styl: {labelStyle((answers.style || suggestStyle(answers)) as SiteStyle)}</div>
            {(answers.sections) && <div>📐 Sekcje: {answers.sections}</div>}
            {answers.contact && <div>📞 Kontakt: {answers.contact}</div>}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>💡 {guideAdvice("done", answers)}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={finish}>🚀 Zbuduj stronę</button>
            <button className="btn" style={{ width: "auto" }} onClick={() => setStep("business")}>↩ Od nowa</button>
          </div>
        </>
      )}
    </div>
  );
}
