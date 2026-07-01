import { useMemo, useState } from "react";
import Modal from "./Modal";
import { store } from "../lib/store";
import { verdictOf, disputeEvidence, calibrationSummary, calibrationText } from "../lib/predictionLedger";
import { buildChiefBriefing } from "../lib/chiefOfStaff";
import { getWorld } from "../lib/worldModel";
import { reflect } from "../lib/reflection";
import { loadEpisodes } from "../lib/episodicMemory";
import { analyzePerformance, assessmentSummary } from "../lib/selfImprove";
import { getRouteLog } from "../lib/modelRouter";
import { reliabilityStats, reliabilityVerdict } from "../lib/errorLog";
import type { EntityKind } from "../types";

// 🧠 Umysł JARVISA — jedno okno pokazujące „co JARVIS myśli": odprawa dnia (Chief of Staff),
// Twój model świata (osoby/projekty/firmy), refleksje (wzorce) i samoocena (jak mu idzie).
// Wszystko liczone lokalnie z danych — bez sieci.
const KIND_ICON: Record<EntityKind, string> = { person: "👤", project: "📁", company: "🏢", task: "✅", topic: "💡" };

export default function Mind({ onClose }: { onClose: () => void }) {

  const data = useMemo(() => {
    const d = store.data;
    const people = d.world?.entities || [];
    const brief = buildChiefBriefing({ tasks: d.tasks, reminders: d.reminders, calendar: d.calendar, leads: d.leads, people }, Date.now());
    const world = getWorld();
    const topEntities = [...world.entities].sort((a, b) => b.confidence - a.confidence).slice(0, 12);
    const reflections = reflect({ episodes: loadEpisodes(), people, tasks: d.tasks }, Date.now());
    const stats = reliabilityStats();
    const assess = analyzePerformance(getRouteLog(), stats.byScope, Date.now(), { ollamaReady: !!store.settings.ollamaUrl?.trim() });
    return { brief, topEntities, world, reflections, assess, verdict: reliabilityVerdict(stats) };
  }, []);

  const { brief, topEntities, world, reflections, assess, verdict } = data;
  const vColor = verdict.level === "ok" ? "var(--ok,#62e6a8)" : verdict.level === "bad" ? "var(--danger,#ff7a7a)" : "var(--gold)";

  return (
    <Modal
      title="🧠 Umysł JARVISA"
      onClose={onClose}
      foot={<button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Zamknij</button>}
    >
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Co JARVIS wie i myśli — odprawa, Twój świat, wzorce i samoocena. Wszystko liczone lokalnie.</p>

          {/* 🩺 Werdykt niezawodności — czytelny sygnał z telemetrii (zero cichych awarii) */}
          <div className="journal-card" style={{ padding: "8px 10px", marginBottom: 10, borderLeft: `3px solid ${vColor}` }}>
            <div style={{ fontSize: 13 }}><b>🩺 Niezawodność:</b> {verdict.text}</div>
          </div>

          {/* 🧭 Odprawa (Chief of Staff) */}
          <h3 style={{ marginBottom: 4 }}>🧭 Odprawa — {brief.heading}</h3>
          {brief.sections.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Spokojnie — nic pilnego. Dobry moment na pracę głęboką.</p>}
          {brief.sections.map((s) => (
            <div key={s.title} className="journal-card" style={{ padding: "8px 10px", marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
              {s.items.map((it, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.6 }}>{it}</div>)}
            </div>
          ))}
          {brief.actions.length > 0 && (
            <div className="journal-card" style={{ padding: "8px 10px", marginBottom: 10, borderLeft: "3px solid var(--gold)" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>✅ Następne kroki</div>
              {brief.actions.map((a, i) => <div key={i} style={{ fontSize: 12, lineHeight: 1.6 }}>→ {a}</div>)}
            </div>
          )}

          {/* 🌍 Model świata */}
          <h3 style={{ marginBottom: 4 }}>🌍 Twój świat <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>({world.entities.length} encji · {world.relations.length} powiązań)</span></h3>
          {topEntities.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Jeszcze pusto — model świata pozna osoby, projekty i firmy w miarę rozmów.</p>
          ) : (
            <div className="chips" style={{ flexWrap: "wrap", marginBottom: 10 }}>
              {topEntities.map((e) => (
                <span key={e.id} className="chip" title={`pewność ${Math.round(e.confidence * 100)}% · wzmianek ${e.mentions}`}>
                  {KIND_ICON[e.kind]} {e.name}{e.mentions > 1 ? ` ×${e.mentions}` : ""}
                </span>
              ))}
            </div>
          )}

          {/* 🪞 Refleksje */}
          <h3 style={{ marginBottom: 4 }}>🪞 Co zauważyłem</h3>
          {reflections.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>Za mało danych na wnioski — porozmawiajmy więcej.</p>
          ) : (
            <div className="journal-card" style={{ padding: "8px 10px", marginBottom: 10 }}>
              {reflections.map((r) => <div key={r.id} style={{ fontSize: 13, lineHeight: 1.7 }}>{r.text}</div>)}
            </div>
          )}

          {/* 🧪 Samoocena */}
          <h3 style={{ marginBottom: 4 }}>🧪 Jak mi idzie</h3>
          <div className="journal-card" style={{ padding: "8px 10px", marginBottom: 10 }}>
            <div style={{ fontSize: 12, whiteSpace: "pre-line", lineHeight: 1.7 }}>{assessmentSummary(assess)}</div>
            {assess.insights.some((i) => i.action) && (
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Poprawki jednym kliknięciem znajdziesz w 🛡 Strażniku.</div>
            )}
          </div>

          {/* 🔮 Dziennik Predykcji — pełna kontrola użytkownika (podgląd, dowody, uczenie, czyszczenie) */}
          <PredictionsSection />
    </Modal>
  );
}

/** Sekcja kontroli Dziennika Predykcji: aktywne prognozy z przesłankami, rozstrzygnięcia z opcją
 *  „dowód błędny", wyłącznik uczenia i czyszczenie historii. To PROGNOZY, nie fakty — sekcja mówi
 *  to wprost. UI tylko czyta/steruje — cała logika w predictionLedger.ts (czysty silnik). */
function PredictionsSection() {
  const [, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const ledger = store.data.predictionLedger || [];
  const learningOn = store.settings.predictionLearning !== false;
  const pending = ledger.filter((r) => !r.evidence).sort((a, b) => a.checkAt - b.checkAt).slice(0, 6);
  const resolved = ledger.filter((r) => !!r.evidence).sort((a, b) => (b.evidence!.observedAt - a.evidence!.observedAt)).slice(0, 5);
  const fmt = (ms: number) => new Date(ms).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  const V_ICON: Record<string, string> = { correct: "📉", prevented: "✅", moot: "ℹ" };

  return (
    <>
      <h3 style={{ marginBottom: 4 }}>🔮 Prognozy <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(to przewidywania, nie fakty — każde rozstrzygam po terminie z realnych danych)</span></h3>
      <div className="journal-card" style={{ padding: "8px 10px", marginBottom: 6 }}>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>{calibrationText(calibrationSummary(ledger))}</div>
      </div>
      {pending.length > 0 && (
        <div className="journal-card" style={{ padding: "8px 10px", marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Aktywne (czekają na termin)</div>
          {pending.map((p) => (
            <div key={p.id} style={{ fontSize: 12, lineHeight: 1.6 }} title={p.basis.join(" · ")}>
              • {p.claim} <span className="muted">(pewność {Math.round(p.confidence * 100)}% · sprawdzę {fmt(p.checkAt)} · na podstawie: {p.basis[0]})</span>
            </div>
          ))}
        </div>
      )}
      {resolved.length > 0 && (
        <div className="journal-card" style={{ padding: "8px 10px", marginBottom: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Ostatnie rozstrzygnięcia</div>
          {resolved.map((r) => (
            <div key={r.id} style={{ fontSize: 12, lineHeight: 1.6, display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
              <span>{V_ICON[verdictOf(r)] || "•"} {r.entityLabel}: {r.evidence!.outcome}</span>
              {r.evidence!.disputedAt
                ? <span className="muted">(oznaczone jako błędne — nie liczy się do uczenia)</span>
                : (
                  <button
                    type="button"
                    className="btn"
                    style={{ fontSize: 11, padding: "1px 8px" }}
                    title="Rozstrzygnięcie zostaje w historii, ale wypada z uczenia i statystyk celności."
                    onClick={() => { store.setData((d) => { d.predictionLedger = disputeEvidence(d.predictionLedger || [], r.id, Date.now()); }); refresh(); }}
                  >
                    Dowód błędny?
                  </button>
                )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
        <label style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={learningOn}
            onChange={(e) => { store.setSettings({ predictionLearning: e.target.checked }); refresh(); }}
          />
          Ucz się z rozstrzygnięć (okno/pewność per klient)
        </label>
        {ledger.length > 0 && (
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: "2px 8px" }}
            onClick={() => {
              if (!window.confirm(`Wyczyścić historię prognoz (${ledger.length})? To zeruje też wszystko, czego się z niej nauczyłem.`)) return;
              store.setData((d) => { d.predictionLedger = []; });
              refresh();
            }}
          >
            🗑 Wyczyść historię prognoz
          </button>
        )}
      </div>
    </>
  );
}
