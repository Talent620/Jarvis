import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Compass,
  Feather,
  Flame,
  HeartHandshake,
  Lock,
  MessageCircleHeart,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Sun,
  Trash2,
  Unlock,
  Wind,
} from "lucide-react";
import Modal from "./Modal";
import {
  addDaysDateStr,
  addLifePromise,
  addProofVictory,
  addTimeCapsule,
  CHARACTER_PILLARS,
  computeCharacterProfile,
  loadLifeCompass,
  localDateStr,
  markPromiseToday,
  POLISH_CRISIS_HELPLINES,
  readyTimeCapsules,
  saveLifeCompass,
  STARTER_PROMISES,
  subscribeLifeCompass,
  SUGGESTED_VALUES,
  upsertTodayRitual,
  type CharacterPillarId,
  type LifeCompassState,
} from "../lib/lifeCompass";
import { loadFlowSessions } from "../lib/flowEngine";
import { store, uid } from "../lib/store";
import { toast } from "../lib/toast";

export interface GuardianSoulModalProps {
  onClose: () => void;
  onStartTalk?: (prompt: string) => void;
}

type SoulTab = "today" | "promises" | "vault" | "compass" | "breathe";

const BREATH_PHASES: Array<{ key: "in" | "hold" | "out"; label: string; hint: string; seconds: number }> = [
  { key: "in", label: "Wdech nosem", hint: "Spokojnie napełnij płuca i rozluźnij barki", seconds: 4 },
  { key: "hold", label: "Zatrzymaj", hint: "Chwila ciszy między bodźcem a reakcją", seconds: 4 },
  { key: "out", label: "Długi wydech", hint: "Powoli wypuść napięcie — dłuższy wydech koi nerwy", seconds: 6 },
];

const DEEP_TALK_STARTERS: Array<{ icon: string; label: string; prompt: string }> = [
  {
    icon: "🤍",
    label: "Ciężki dzień — pogadajmy szczerze",
    prompt: "Miałem ciężki dzień i czuję zmęczenie. Pogadaj ze mną po ludzku jak mądry kumpel i anioł stróż — pomóż mi odzyskać spokój i dystans.",
  },
  {
    icon: "🪞",
    label: "Trudna decyzja — bądź moim lustrem",
    prompt: "Stoję przed ważną decyzją i chcę postąpić zgodnie z moimi wartościami, a nie pod wpływem emocji czy ego. Bądź moim szczerym lustrem i zadaj mi 2 trafne pytania.",
  },
  {
    icon: "🌙",
    label: "Spokojne zamknięcie dnia",
    prompt: "Pomóż mi zrobić uczciwe wieczorne podsumowanie dnia bez samobiczowania: co zrobiłem dobrze, za co mogę być wdzięczny i jaką jedną lekcję zabieram na jutro?",
  },
  {
    icon: "🧭",
    label: "Przypomnij mi kim się staję",
    prompt: "Przypomnij mi na podstawie mojego Kompasu Życia, obietnic i Skarbca Zwycięstw, kim się staję i jaki jeden mały, godny krok warto zrobić dzisiaj.",
  },
];

function buildRadarPolygon(scores: number[], cx: number, cy: number, maxR: number): string {
  const n = scores.length;
  const pts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (Math.max(8, Math.min(100, scores[i])) / 100) * maxR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

export default function GuardianSoulModal({ onClose, onStartTalk }: GuardianSoulModalProps) {
  const [tab, setTab] = useState<SoulTab>("today");
  const [compass, setCompass] = useState<LifeCompassState>(() => loadLifeCompass());

  useEffect(() => {
    return subscribeLifeCompass(() => setCompass(loadLifeCompass()));
  }, []);

  const today = localDateStr();
  const todayRitual = useMemo(
    () => compass.rituals.find((r) => r.date === today),
    [compass.rituals, today],
  );
  const unlockedCapsules = useMemo(() => readyTimeCapsules(compass), [compass]);

  // Pola formularzy Rytuału Dnia
  const [morningIntention, setMorningIntention] = useState(todayRitual?.morningIntention || "");
  const [morningPillar, setMorningPillar] = useState<CharacterPillarId>(todayRitual?.morningPillar || "spokoj");
  const [kindnessAct, setKindnessAct] = useState(todayRitual?.kindnessAct || "");
  const [eveningProud, setEveningProud] = useState(todayRitual?.eveningProud || "");
  const [eveningGrateful, setEveningGrateful] = useState(todayRitual?.eveningGrateful || "");
  const [eveningLesson, setEveningLesson] = useState(todayRitual?.eveningLesson || "");

  // Pola Przymierza ze Sobą
  const [newPromiseTitle, setNewPromiseTitle] = useState("");
  const [newPromisePillar, setNewPromisePillar] = useState<CharacterPillarId>("slownosc");
  const [newPromiseWhy, setNewPromiseWhy] = useState("");

  // Pola Skarbca Zwycięstw i Kapsuły Czasu
  const [proofText, setProofText] = useState("");
  const [proofPillar, setProofPillar] = useState<CharacterPillarId>("odwaga");
  const [capTitle, setCapTitle] = useState("");
  const [capBody, setCapBody] = useState("");
  const [capDate, setCapDate] = useState(() => addDaysDateStr(30));

  // Pola Kompasu & Wartości
  const [northStarDraft, setNorthStarDraft] = useState(compass.northStar);
  const [customValueDraft, setCustomValueDraft] = useState("");
  const [redLineDraft, setRedLineDraft] = useState("");

  // Stan Przewodnika Oddechu 4-4-6
  const [breathActive, setBreathActive] = useState(false);
  const [breathPhaseIdx, setBreathPhaseIdx] = useState(0);
  const [breathLeft, setBreathLeft] = useState(BREATH_PHASES[0].seconds);
  const [breathCycles, setBreathCycles] = useState(0);

  useEffect(() => {
    if (!breathActive) return;
    const timer = window.setInterval(() => {
      setBreathLeft((prev) => {
        if (prev > 1) return prev - 1;
        setBreathPhaseIdx((curIdx) => {
          const nextIdx = (curIdx + 1) % BREATH_PHASES.length;
          if (nextIdx === 0) setBreathCycles((c) => c + 1);
          setBreathLeft(BREATH_PHASES[nextIdx].seconds);
          return nextIdx;
        });
        return prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [breathActive]);

  const profile = useMemo(() => {
    const flowSessions = loadFlowSessions();
    const flowMinutes = flowSessions
      .filter((s) => s.presetId !== "break")
      .reduce((sum, s) => sum + Math.max(0, s.actualMinutes), 0);
    const completedTasks = (store.data.tasks || []).filter((t) => t.done).length;
    const journalEntries = (store.data.journal || []).length;
    return computeCharacterProfile(compass, { flowMinutes, completedTasks, journalEntries });
  }, [compass]);

  const handleSaveMorning = () => {
    if (!morningIntention.trim() && !kindnessAct.trim()) {
      toast("Wpisz choć krótką intencję lub drobny akt dobra.");
      return;
    }
    const next = upsertTodayRitual({
      morningIntention: morningIntention.trim() || undefined,
      morningPillar,
      kindnessAct: kindnessAct.trim() || undefined,
    });
    setCompass(next);
    toast("Poranny Kompas zapisany — JARVIS pamięta Twój kurs na dziś.");
  };

  const handleSaveEvening = () => {
    if (!eveningProud.trim() && !eveningGrateful.trim() && !eveningLesson.trim()) {
      toast("Wpisz choć jedno zdanie z dzisiejszego dnia.");
      return;
    }
    const next = upsertTodayRitual({
      eveningProud: eveningProud.trim() || undefined,
      eveningGrateful: eveningGrateful.trim() || undefined,
      eveningLesson: eveningLesson.trim() || undefined,
    });
    setCompass(next);
    if (eveningProud.trim()) {
      setCompass(addProofVictory(eveningProud.trim(), "prawda", "ritual"));
    }
    // Dopisz dyskretny ślad do Dziennika, by wspomnienia były spójne w całej aplikacji.
    const bodyParts = [
      eveningProud.trim() ? `Duma: ${eveningProud.trim()}` : "",
      eveningGrateful.trim() ? `Wdzięczność: ${eveningGrateful.trim()}` : "",
      eveningLesson.trim() ? `Lekcja na jutro: ${eveningLesson.trim()}` : "",
    ].filter(Boolean);
    if (bodyParts.length > 0) {
      const now = Date.now();
      store.setData((d) => {
        d.journal.unshift({
          id: uid(),
          title: `Wieczorne Lustro (${today})`,
          body: bodyParts.join("\n"),
          tags: ["aniol-stroz", "refleksja"],
          shared: true,
          createdAt: now,
          updatedAt: now,
        });
      });
    }
    toast("Wieczorne Lustro zapisane — dzień domknięty w spokoju.");
  };

  const handleAddPromise = () => {
    if (!newPromiseTitle.trim()) return;
    setCompass(addLifePromise(newPromiseTitle.trim(), newPromisePillar, newPromiseWhy.trim() || undefined));
    setNewPromiseTitle("");
    setNewPromiseWhy("");
    toast("Dodano do Przymierza ze Sobą.");
  };

  const handleRemovePromise = (id: string) => {
    setCompass(saveLifeCompass({ ...compass, promises: compass.promises.filter((p) => p.id !== id) }));
  };

  const handleAddProof = () => {
    if (!proofText.trim()) return;
    setCompass(addProofVictory(proofText.trim(), proofPillar, "user"));
    setProofText("");
    toast("Zapisano w Skarbcu Zwycięstw.");
  };

  const handleRemoveProof = (id: string) => {
    setCompass(saveLifeCompass({ ...compass, proofVault: compass.proofVault.filter((p) => p.id !== id) }));
  };

  const handleAddCapsule = () => {
    if (!capBody.trim()) return;
    setCompass(addTimeCapsule(capTitle.trim() || "List do przyszłego siebie", capBody.trim(), capDate));
    setCapTitle("");
    setCapBody("");
    toast(`Kapsuła Czasu zapieczętowana do ${capDate}.`);
  };

  const handleOpenCapsule = (id: string) => {
    setCompass(
      saveLifeCompass({
        ...compass,
        capsules: compass.capsules.map((c) => (c.id === id ? { ...c, openedAt: Date.now() } : c)),
      }),
    );
  };

  const handleSaveNorthStar = () => {
    setCompass(saveLifeCompass({ ...compass, northStar: northStarDraft.trim() }));
    toast("Gwiazda Północna zapisana — JARVIS będzie jej strzegł.");
  };

  const handleToggleValue = (val: string) => {
    const exists = compass.selectedValues.includes(val);
    const nextVals = exists
      ? compass.selectedValues.filter((v) => v !== val)
      : [...compass.selectedValues, val].slice(0, 12);
    setCompass(saveLifeCompass({ ...compass, selectedValues: nextVals }));
  };

  const handleAddCustomValue = () => {
    const v = customValueDraft.trim();
    if (!v || compass.selectedValues.includes(v)) return;
    setCompass(saveLifeCompass({ ...compass, selectedValues: [...compass.selectedValues, v].slice(0, 12) }));
    setCustomValueDraft("");
  };

  const handleAddRedLine = () => {
    const r = redLineDraft.trim();
    if (!r) return;
    setCompass(saveLifeCompass({ ...compass, redLines: [r, ...compass.redLines].slice(0, 10) }));
    setRedLineDraft("");
  };

  const handleRemoveRedLine = (idx: number) => {
    setCompass(saveLifeCompass({ ...compass, redLines: compass.redLines.filter((_, i) => i !== idx) }));
  };

  const startGuardianTalk = (prompt: string) => {
    store.setSettings({ personalityMode: "ANIOL_STROZ" });
    onClose();
    onStartTalk?.(prompt);
  };

  const activeBreath = BREATH_PHASES[breathPhaseIdx];
  const activePromises = compass.promises.filter((p) => p.active);

  return (
    <Modal
      title="🪽 Anioł Stróż & Kompas Życia"
      ariaLabel="Anioł Stróż i Kompas Życia"
      className="soul-modal-panel"
      onClose={onClose}
    >
      <div className="soul-stack">
        {/* Baner odblokowanego Listu w Czasie */}
        {unlockedCapsules.length > 0 && (
          <div className="soul-capsule-alert">
            <div>
              <strong>⏳ Odblokowany list z przeszłości: {unlockedCapsules[0].title}</strong>
              <p className="muted">Napisany przez Ciebie wcześniej — czeka w zakładce Skarbiec & Czas.</p>
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{ minHeight: 44 }}
              onClick={() => {
                handleOpenCapsule(unlockedCapsules[0].id);
                setTab("vault");
              }}
            >
              <Unlock size={15} /> Otwórz list
            </button>
          </div>
        )}

        {/* Pasek zakładek */}
        <nav className="soul-tabs" aria-label="Sekcje Anioła Stróża">
          <button
            type="button"
            className={`soul-tab-btn${tab === "today" ? " active" : ""}`}
            style={{ minHeight: 44 }}
            aria-pressed={tab === "today"}
            onClick={() => setTab("today")}
          >
            <Sun size={15} /> Dziś
          </button>
          <button
            type="button"
            className={`soul-tab-btn${tab === "promises" ? " active" : ""}`}
            style={{ minHeight: 44 }}
            aria-pressed={tab === "promises"}
            onClick={() => setTab("promises")}
          >
            <Shield size={15} /> Przymierze ({activePromises.length})
          </button>
          <button
            type="button"
            className={`soul-tab-btn${tab === "vault" ? " active" : ""}`}
            style={{ minHeight: 44 }}
            aria-pressed={tab === "vault"}
            onClick={() => setTab("vault")}
          >
            <Sparkles size={15} /> Skarbiec ({compass.proofVault.length})
          </button>
          <button
            type="button"
            className={`soul-tab-btn${tab === "compass" ? " active" : ""}`}
            style={{ minHeight: 44 }}
            aria-pressed={tab === "compass"}
            onClick={() => setTab("compass")}
          >
            <Compass size={15} /> Kompas
          </button>
          <button
            type="button"
            className={`soul-tab-btn${tab === "breathe" ? " active" : ""}`}
            style={{ minHeight: 44 }}
            aria-pressed={tab === "breathe"}
            onClick={() => setTab("breathe")}
          >
            <Wind size={15} /> Oddech
          </button>
        </nav>

        {/* TAB 1: DZIŚ & RYTUAŁY + ROZMOWA OD SERCA */}
        {tab === "today" && (
          <div className="soul-tab-body">
            {/* Rozmowa z Aniołem Stróżem i Kolegą */}
            {onStartTalk && (
              <section className="soul-card soul-talk-card">
                <div className="soul-card-head">
                  <MessageCircleHeart size={16} />
                  <strong>Pogadajmy po ludzku (włącza tryb 🪽 Anioł Stróż)</strong>
                </div>
                <div className="soul-talk-grid">
                  {DEEP_TALK_STARTERS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className="soul-talk-btn"
                      style={{ minHeight: 44 }}
                      onClick={() => startGuardianTalk(s.prompt)}
                    >
                      <span>{s.icon}</span>
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Poranny Kompas */}
            <section className="soul-card">
              <div className="soul-card-head">
                <Sun size={16} />
                <strong>🌅 Poranny Kompas (30 sekund przed hałasem dnia)</strong>
              </div>
              <label className="soul-field">
                <span className="muted">Jaki jeden kierunek albo jakość chcę dziś wnieść?</span>
                <input
                  type="text"
                  value={morningIntention}
                  placeholder="np. Spokój w trudnej rozmowie i zero pośpiechu"
                  onChange={(e) => setMorningIntention(e.target.value)}
                />
              </label>
              <label className="soul-field">
                <span className="muted">Filar charakteru na dziś</span>
                <select
                  value={morningPillar}
                  onChange={(e) => setMorningPillar(e.target.value as CharacterPillarId)}
                >
                  {CHARACTER_PILLARS.map((p) => (
                    <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
                  ))}
                </select>
              </label>
              <label className="soul-field">
                <span className="muted">Drobny akt dobra (dla kogoś bliskiego albo dla siebie)</span>
                <input
                  type="text"
                  value={kindnessAct}
                  placeholder="np. Zadzwoń do taty i zapytaj jak się czuje"
                  onChange={(e) => setKindnessAct(e.target.value)}
                />
              </label>
              <button type="button" className="btn-primary" style={{ minHeight: 44 }} onClick={handleSaveMorning}>
                <CheckCircle2 size={15} /> Zapisz Poranny Kompas
              </button>
            </section>

            {/* Wieczorne Lustro */}
            <section className="soul-card">
              <div className="soul-card-head">
                <Feather size={16} />
                <strong>🌙 Wieczorne Lustro (bez wyrzutów sumienia)</strong>
              </div>
              <label className="soul-field">
                <span className="muted">1 rzecz, z której możesz być dziś po cichu dumny (trafi do Skarbca Zwycięstw)</span>
                <input
                  type="text"
                  value={eveningProud}
                  placeholder="np. Nie wybuchłem w złości, tylko wyszedłem na spacer"
                  onChange={(e) => setEveningProud(e.target.value)}
                />
              </label>
              <label className="soul-field">
                <span className="muted">1 mała wdzięczność z dzisiaj</span>
                <input
                  type="text"
                  value={eveningGrateful}
                  placeholder="np. Ciepła kawa rano i zdrowie bliskich"
                  onChange={(e) => setEveningGrateful(e.target.value)}
                />
              </label>
              <label className="soul-field">
                <span className="muted">1 spokojna lekcja na jutro</span>
                <input
                  type="text"
                  value={eveningLesson}
                  placeholder="np. Odłożyć telefon o 22:30, żeby jutro mieć świeżą głowę"
                  onChange={(e) => setEveningLesson(e.target.value)}
                />
              </label>
              <button type="button" className="btn-secondary" style={{ minHeight: 44 }} onClick={handleSaveEvening}>
                <CheckCircle2 size={15} /> Zamknij dzień i zapisz w Dzienniku
              </button>
            </section>
          </div>
        )}

        {/* TAB 2: PRZYMIERZE ZE SOBĄ (MAŁE OBIETNICE + PROTOKOŁ ZERO WSTYDU) */}
        {tab === "promises" && (
          <div className="soul-tab-body">
            <section className="soul-card">
              <div className="soul-card-head">
                <Shield size={16} />
                <strong>Przymierze ze Sobą — protokół Zero Wstydu</strong>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                Zaufanie do siebie nie wymaga perfekcji. Jeśli dziś się potknąłeś — kliknij <b>„Wróć na kurs”</b>.
                Powrót po upadku buduje charakter silniej niż idealna passa.
              </p>

              {activePromises.length === 0 ? (
                <div className="soul-starters">
                  <span className="muted" style={{ fontSize: 12 }}>Wybierz na start 1–2 proste obietnice (albo dodaj własną poniżej):</span>
                  {STARTER_PROMISES.map((sp) => (
                    <button
                      key={sp.title}
                      type="button"
                      className="soul-starter-row"
                      style={{ minHeight: 44 }}
                      onClick={() => {
                        setCompass(addLifePromise(sp.title, sp.pillar, sp.why));
                        toast(`Dodano obietnicę: ${sp.title}`);
                      }}
                    >
                      <span><Plus size={14} style={{ verticalAlign: "middle", marginRight: 5 }} /><b>{sp.title}</b></span>
                      <small className="muted">{sp.why}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="soul-promise-list">
                  {activePromises.map((p) => {
                    const keptToday = p.keptDates.includes(today);
                    const comebackToday = p.comebackDates.includes(today);
                    const pillarMeta = CHARACTER_PILLARS.find((x) => x.id === p.pillar) || CHARACTER_PILLARS[2];
                    return (
                      <div key={p.id} className={`soul-promise-item${keptToday ? " is-kept" : ""}`}>
                        <div className="soul-promise-info">
                          <div className="soul-promise-title">
                            <span>{pillarMeta.icon}</span>
                            <strong>{p.title}</strong>
                          </div>
                          {p.why && <div className="muted" style={{ fontSize: 12 }}>{p.why}</div>}
                          <div className="soul-promise-meta muted">
                            Dotrzymane: <b>{p.keptDates.length}×</b> · Powroty na kurs: <b>{p.comebackDates.length}×</b>
                          </div>
                        </div>
                        <div className="soul-promise-actions">
                          <button
                            type="button"
                            className={keptToday ? "btn-primary" : "btn-secondary"}
                            style={{ minHeight: 44 }}
                            onClick={() => {
                              setCompass(markPromiseToday(p.id, "kept"));
                              if (!keptToday) toast(`Dotrzymane: ${p.title} ✓`);
                            }}
                          >
                            <CheckCircle2 size={15} /> {keptToday ? "Dotrzymane ✓" : "Dotrzymałem"}
                          </button>
                          {!keptToday && (
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ minHeight: 44 }}
                              title="Potknąłem się, ale bez wstydu wracam na kurs"
                              onClick={() => {
                                setCompass(markPromiseToday(p.id, "comeback"));
                                toast("Powrót na kurs zapisany — szacunek za szczerość i ciągłość.");
                              }}
                            >
                              <RotateCcw size={14} /> {comebackToday ? "Wrócono ✓" : "Wróć na kurs"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ minHeight: 44 }}
                            aria-label="Usuń obietnicę"
                            onClick={() => handleRemovePromise(p.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Dodaj własną obietnicę */}
            <section className="soul-card">
              <div className="soul-card-head">
                <Plus size={16} />
                <strong>Nowa obietnica w Przymierzu</strong>
              </div>
              <input
                type="text"
                value={newPromiseTitle}
                placeholder="np. Codziennie 15 min spaceru bez słuchawek"
                onChange={(e) => setNewPromiseTitle(e.target.value)}
              />
              <div className="soul-inline-row">
                <select
                  value={newPromisePillar}
                  onChange={(e) => setNewPromisePillar(e.target.value as CharacterPillarId)}
                >
                  {CHARACTER_PILLARS.map((p) => (
                    <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newPromiseWhy}
                  placeholder="Dlaczego to dla mnie ważne? (opcjonalnie)"
                  onChange={(e) => setNewPromiseWhy(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn-primary"
                style={{ minHeight: 44 }}
                disabled={!newPromiseTitle.trim()}
                onClick={handleAddPromise}
              >
                <Plus size={15} /> Dodaj do Przymierza
              </button>
            </section>
          </div>
        )}

        {/* TAB 3: SKARBIEC ZWYCIĘSTW & KAPSUŁY CZASU */}
        {tab === "vault" && (
          <div className="soul-tab-body">
            <section className="soul-card">
              <div className="soul-card-head">
                <Sparkles size={16} />
                <strong>🏆 Skarbiec Zwycięstw (Twoje prawdziwe dowody siły)</strong>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                W trudnym dniu głowa potrafi wmówić Ci, że nic nie potrafisz. Tutaj zbierasz prawdziwe fakty z własnego życia —
                JARVIS automatycznie przypomni Ci je, gdy przyjdzie zwątpienie.
              </p>
              <div className="soul-inline-row">
                <input
                  type="text"
                  value={proofText}
                  placeholder="np. Powiedziałem szczerą prawdę mimo stresu / Przetrwałem ciężki tydzień"
                  onChange={(e) => setProofText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddProof();
                    }
                  }}
                />
                <select
                  value={proofPillar}
                  onChange={(e) => setProofPillar(e.target.value as CharacterPillarId)}
                >
                  {CHARACTER_PILLARS.map((p) => (
                    <option key={p.id} value={p.id}>{p.icon} {p.shortLabel}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ minHeight: 44 }}
                  disabled={!proofText.trim()}
                  onClick={handleAddProof}
                >
                  <Plus size={15} /> Zapisz
                </button>
              </div>
              {compass.proofVault.length > 0 && (
                <div className="soul-proof-list">
                  {compass.proofVault.slice(0, 15).map((item) => {
                    const meta = CHARACTER_PILLARS.find((p) => p.id === item.pillar) || CHARACTER_PILLARS[1];
                    return (
                      <div key={item.id} className="soul-proof-item">
                        <div className="soul-proof-copy">
                          <span>{meta.icon} <b>{item.text}</b></span>
                          <small className="muted">
                            {new Date(item.createdAt).toLocaleDateString("pl-PL")} · {meta.shortLabel}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ minHeight: 44 }}
                          aria-label="Usuń dowód ze Skarbca"
                          onClick={() => handleRemoveProof(item.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Kapsuła Czasu — List do Przyszłego Siebie */}
            <section className="soul-card">
              <div className="soul-card-head">
                <Lock size={16} />
                <strong>⏳ Kapsuła Czasu — List do Przyszłego Siebie</strong>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                Napisz wiadomość w chwili jasności — zostanie zapieczętowana i odblokuje się dopiero wybranego dnia.
              </p>
              <input
                type="text"
                value={capTitle}
                placeholder="Tytuł listu, np. Przeczytaj, gdy znów zwątpisz"
                onChange={(e) => setCapTitle(e.target.value)}
              />
              <textarea
                rows={3}
                value={capBody}
                placeholder="Co chcesz przypomnieć sobie za miesiąc lub za kwartał?"
                onChange={(e) => setCapBody(e.target.value)}
              />
              <div className="soul-inline-row">
                <label className="soul-date-label">
                  <span className="muted">Odblokuj dnia:</span>
                  <input type="date" value={capDate} onChange={(e) => setCapDate(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 44 }}
                  onClick={() => setCapDate(addDaysDateStr(7))}
                >
                  +7 dni
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 44 }}
                  onClick={() => setCapDate(addDaysDateStr(30))}
                >
                  +30 dni
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 44 }}
                  onClick={() => setCapDate(addDaysDateStr(90))}
                >
                  +90 dni
                </button>
              </div>
              <button
                type="button"
                className="btn-primary"
                style={{ minHeight: 44 }}
                disabled={!capBody.trim()}
                onClick={handleAddCapsule}
              >
                <Lock size={15} /> Zapieczętuj list w czasie
              </button>

              {compass.capsules.length > 0 && (
                <div className="soul-capsule-list">
                  {compass.capsules.map((c) => {
                    const isReady = c.unlockDate <= today;
                    const isOpened = Boolean(c.openedAt);
                    return (
                      <div key={c.id} className={`soul-capsule-item${isReady ? " is-ready" : ""}`}>
                        <div className="soul-capsule-head">
                          <strong>{isOpened ? "📜" : isReady ? "🔓" : "🔒"} {c.title}</strong>
                          <span className="muted">
                            {isOpened
                              ? `Otwarto (${c.unlockDate})`
                              : isReady
                                ? "Gotowy do otwarcia!"
                                : `Zapieczętowany do ${c.unlockDate}`}
                          </span>
                        </div>
                        {isOpened ? (
                          <p className="soul-capsule-body">{c.body}</p>
                        ) : isReady ? (
                          <button
                            type="button"
                            className="btn-primary"
                            style={{ minHeight: 44 }}
                            onClick={() => handleOpenCapsule(c.id)}
                          >
                            <Unlock size={15} /> Otwórz list z {new Date(c.createdAt).toLocaleDateString("pl-PL")}
                          </button>
                        ) : (
                          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                            Treść ukryta aż do {c.unlockDate}.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 4: KOMPAS, RADAR 7 FILARÓW I WARTOŚCI */}
        {tab === "compass" && (
          <div className="soul-tab-body">
            {/* 7-osiowy SVG Radar Charakteru */}
            <section className="soul-card soul-radar-card">
              <div className="soul-card-head">
                <Compass size={16} />
                <strong>🧭 7 Filarów Charakteru (z Twoich realnych działań)</strong>
              </div>
              <div className="soul-radar-layout">
                <svg
                  width="220"
                  height="220"
                  viewBox="0 0 220 220"
                  role="img"
                  aria-label={`Radar 7 filarów charakteru — średnia ${profile.overallScore} na 100`}
                >
                  {[25, 50, 75, 100].map((lvl) => (
                    <polygon
                      key={lvl}
                      points={buildRadarPolygon([lvl, lvl, lvl, lvl, lvl, lvl, lvl], 110, 110, 76)}
                      className="soul-radar-grid"
                    />
                  ))}
                  <polygon
                    points={buildRadarPolygon(profile.points.map((p) => p.score), 110, 110, 76)}
                    className="soul-radar-fill"
                  />
                  {profile.points.map((p, i) => {
                    const angle = (Math.PI * 2 * i) / profile.points.length - Math.PI / 2;
                    const lx = 110 + 95 * Math.cos(angle);
                    const ly = 110 + 95 * Math.sin(angle);
                    return (
                      <text
                        key={p.id}
                        x={lx}
                        y={ly}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="soul-radar-label"
                      >
                        {p.icon} {p.shortLabel}
                      </text>
                    );
                  })}
                </svg>
                <div className="soul-radar-stats">
                  <div>
                    <span className="muted">Spójność kursu</span>
                    <strong><Flame size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />{profile.overallScore}/100</strong>
                  </div>
                  <div>
                    <span className="muted">Najmocniejszy filar</span>
                    <strong>{profile.strongest.icon} {profile.strongest.label} ({profile.strongest.score})</strong>
                  </div>
                  <div>
                    <span className="muted">Na czułą uwagę dziś</span>
                    <strong>{profile.needsCare.icon} {profile.needsCare.label} ({profile.needsCare.score})</strong>
                  </div>
                  <div>
                    <span className="muted">Fakty</span>
                    <strong>{profile.keptTotal} obietnic · {profile.comebacksTotal} powrotów · {profile.proofCount} dowodów</strong>
                  </div>
                </div>
              </div>
            </section>

            {/* Gwiazda Północna */}
            <section className="soul-card">
              <div className="soul-card-head">
                <HeartHandshake size={16} />
                <strong>⭐ Gwiazda Północna — „Kim się staję”</strong>
              </div>
              <textarea
                rows={2}
                value={northStarDraft}
                placeholder="np. Spokojny, słowny, uczciwy człowiek, na którym ja sam i moi bliscy możemy zawsze polegać."
                onChange={(e) => setNorthStarDraft(e.target.value)}
              />
              <button type="button" className="btn-primary" style={{ minHeight: 44 }} onClick={handleSaveNorthStar}>
                <CheckCircle2 size={15} /> Zapisz Gwiazdę Północną
              </button>
            </section>

            {/* Wartości */}
            <section className="soul-card">
              <div className="soul-card-head">
                <Sparkles size={16} />
                <strong>Wartości, którymi się kierujesz</strong>
              </div>
              <div className="soul-value-chips">
                {Array.from(new Set([...SUGGESTED_VALUES, ...compass.selectedValues])).map((v) => {
                  const active = compass.selectedValues.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      className={`soul-val-chip${active ? " active" : ""}`}
                      style={{ minHeight: 44 }}
                      aria-pressed={active}
                      onClick={() => handleToggleValue(v)}
                    >
                      {active ? "✓ " : "+ "}{v}
                    </button>
                  );
                })}
              </div>
              <div className="soul-inline-row">
                <input
                  type="text"
                  value={customValueDraft}
                  placeholder="Dodaj własną wartość…"
                  onChange={(e) => setCustomValueDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomValue();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 44 }}
                  disabled={!customValueDraft.trim()}
                  onClick={handleAddCustomValue}
                >
                  <Plus size={15} /> Dodaj
                </button>
              </div>
            </section>

            {/* Granice / Cienie do strzeżenia */}
            <section className="soul-card">
              <div className="soul-card-head">
                <Shield size={16} />
                <strong>Granice, których strzeżesz (przed czym ma Cię ostrzegać Anioł Stróż)</strong>
              </div>
              <div className="soul-inline-row">
                <input
                  type="text"
                  value={redLineDraft}
                  placeholder="np. Nie piszę ważnych wiadomości w gniewie"
                  onChange={(e) => setRedLineDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddRedLine();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ minHeight: 44 }}
                  disabled={!redLineDraft.trim()}
                  onClick={handleAddRedLine}
                >
                  <Plus size={15} /> Dodaj
                </button>
              </div>
              {compass.redLines.length > 0 && (
                <div className="soul-redlines">
                  {compass.redLines.map((rl, idx) => (
                    <div key={`${idx}-${rl}`} className="soul-redline-row">
                      <span>🛡 {rl}</span>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ minHeight: 44 }}
                        aria-label="Usuń granicę"
                        onClick={() => handleRemoveRedLine(idx)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 5: ODDECH RATUNKOWY 4-4-6 + UZIEMIENIE + TARCZA KRYZYSOWA */}
        {tab === "breathe" && (
          <div className="soul-tab-body">
            <section className="soul-card soul-breath-card">
              <div className="soul-card-head">
                <Wind size={16} />
                <strong>🫁 Reset Emocji w 60 sekund (Oddech 4-4-6)</strong>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                Wydłużony wydech naturalnie uspokaja układ nerwowy zanim powiesz coś w złości lub podejmiesz impulsywną decyzję.
              </p>

              <div className={`soul-breath-orb phase-${breathActive ? activeBreath.key : "idle"}`}>
                <div className="soul-breath-sec">{breathActive ? `${breathLeft}s` : "4·4·6"}</div>
                <div className="soul-breath-phase">{breathActive ? activeBreath.label : "Gotowy"}</div>
              </div>
              <p className="soul-breath-hint muted">
                {breathActive ? activeBreath.hint : `Ukończone cykle w tej sesji: ${breathCycles}`}
              </p>

              <div className="soul-inline-row" style={{ justifyContent: "center" }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ minHeight: 46, minWidth: 180 }}
                  onClick={() => {
                    if (!breathActive) {
                      setBreathPhaseIdx(0);
                      setBreathLeft(BREATH_PHASES[0].seconds);
                      setBreathActive(true);
                    } else {
                      setBreathActive(false);
                    }
                  }}
                >
                  {breathActive ? "Zatrzymaj" : "Rozpocznij 4-4-6"}
                </button>
              </div>
            </section>

            <section className="soul-card">
              <strong>🌿 Szybkie uziemienie 5-4-3-2-1 (powrót do tu i teraz)</strong>
              <ul className="soul-grounding-list muted">
                <li><b>5</b> rzeczy, które teraz widzisz wokół siebie</li>
                <li><b>4</b> rzeczy, których możesz dotknąć (krzesło, materiał, dłonie)</li>
                <li><b>3</b> dźwięki, które właśnie słyszysz</li>
                <li><b>2</b> zapachy albo wrażenie powietrza w nosie</li>
                <li><b>1</b> spokojna myśl: <i>„Ta chwila minie. Zrobię tylko jeden uczciwy krok.”</i></li>
              </ul>
            </section>

            <section className="soul-card soul-crisis-box">
              <strong>🤍 Tarcza Wsparcia (Polska, bezpłatnie i anonimowo)</strong>
              <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
                {POLISH_CRISIS_HELPLINES}
              </p>
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}
