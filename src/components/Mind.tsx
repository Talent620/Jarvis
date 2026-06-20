import { useMemo } from "react";
import { useEscape } from "../hooks/useEscape";
import { store } from "../lib/store";
import { buildChiefBriefing } from "../lib/chiefOfStaff";
import { getWorld } from "../lib/worldModel";
import { reflect } from "../lib/reflection";
import { loadEpisodes } from "../lib/episodicMemory";
import { analyzePerformance, assessmentSummary } from "../lib/selfImprove";
import { getRouteLog } from "../lib/modelRouter";
import { reliabilityStats } from "../lib/errorLog";
import type { EntityKind } from "../types";

// 🧠 Umysł JARVISA — jedno okno pokazujące „co JARVIS myśli": odprawa dnia (Chief of Staff),
// Twój model świata (osoby/projekty/firmy), refleksje (wzorce) i samoocena (jak mu idzie).
// Wszystko liczone lokalnie z danych — bez sieci.
const KIND_ICON: Record<EntityKind, string> = { person: "👤", project: "📁", company: "🏢", task: "✅", topic: "💡" };

export default function Mind({ onClose }: { onClose: () => void }) {
  useEscape(onClose);

  const data = useMemo(() => {
    const d = store.data;
    const people = d.world?.entities || [];
    const brief = buildChiefBriefing({ tasks: d.tasks, reminders: d.reminders, calendar: d.calendar, leads: d.leads, people }, Date.now());
    const world = getWorld();
    const topEntities = [...world.entities].sort((a, b) => b.confidence - a.confidence).slice(0, 12);
    const reflections = reflect({ episodes: loadEpisodes(), people, tasks: d.tasks }, Date.now());
    const assess = analyzePerformance(getRouteLog(), reliabilityStats().byScope, Date.now(), { ollamaReady: !!store.settings.ollamaUrl?.trim() });
    return { brief, topEntities, world, reflections, assess };
  }, []);

  const { brief, topEntities, world, reflections, assess } = data;

  return (
    <div className="sheet" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head"><div className="grabber" /><h2>🧠 Umysł JARVISA</h2></div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Co JARVIS wie i myśli — odprawa, Twój świat, wzorce i samoocena. Wszystko liczone lokalnie.</p>

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
          <div className="journal-card" style={{ padding: "8px 10px" }}>
            <div style={{ fontSize: 12, whiteSpace: "pre-line", lineHeight: 1.7 }}>{assessmentSummary(assess)}</div>
            {assess.insights.some((i) => i.action) && (
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Poprawki jednym kliknięciem znajdziesz w 🛡 Strażniku.</div>
            )}
          </div>
        </div>
        <div className="panel-foot">
          <button className="btn primary" style={{ width: "100%" }} onClick={onClose}>Zamknij</button>
        </div>
      </div>
    </div>
  );
}
