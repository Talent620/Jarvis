// @vitest-environment jsdom
// === Testy ZACHOWANIA (nie regexów na źródle): użytkownik widzi właściwy stan i jego akcje działają ===
// Prawdziwe komponenty (LeadDetail, Mind) montowane w jsdom przez createRoot; zmiany store'a
// przechodzą przez realną subskrypcję (useStore) — dokładnie ta ścieżka, którą widzi użytkownik.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import LeadDetail from "../src/components/LeadDetail";
import Mind from "../src/components/Mind";
import { store } from "../src/lib/store";
import { PREDICTION_LOGIC_VERSION } from "../src/lib/predictionLedger";
import { nextNudge, resetProactive, markShown } from "../src/lib/proactive";
import type { PredictionRecord, PredictionEvidence } from "../src/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 86_400_000;

const rec = (over: Partial<PredictionRecord> = {}): PredictionRecord => ({
  id: "p1", kind: "relationship_neglect", logicVersion: PREDICTION_LOGIC_VERSION,
  entityId: "lead1", entityLabel: "Firma Test", madeAt: Date.now() - 1 * DAY, checkAt: Date.now() + 6 * DAY,
  inputState: {}, claim: "Jeśli w ciągu 7 dni nie skontaktujesz się z „Firma Test”, przerwa w kontakcie się pogłębi.",
  successCriterion: "test", confidence: 0.7, assumptions: [], sources: [], basis: ["ostatni kontakt: 10 dni temu"], ...over,
});
const ev = (verdict: PredictionEvidence["verdict"], over: Partial<PredictionEvidence> = {}): PredictionEvidence => ({
  observedAt: Date.now(), outcome: "Brak jakiegokolwiek kontaktu do terminu — przerwa faktycznie wystąpiła.",
  evidence: [], verdict, reason: "reguła: test", confidenceAfterResolution: 0.7, ...over,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  store.setData((d) => {
    // status "new" → lead nie kwalifikuje się do nudge'a follow-upów (ten ma wyższy priorytet
    // niż prognozy i zasłaniałby testowane zachowanie).
    d.leads = [{ id: "lead1", company: "Firma Test", status: "new", createdAt: 1, updatedAt: 1 }];
    d.predictionLedger = [];
    d.financeProjects = [];
    d.tasks = []; d.reminders = []; d.calendar = [];
  });
  store.setSettings({ predictionLearning: true });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (el: React.ReactElement) => act(() => { root.render(el); });

describe("LeadDetail — teczka pokazuje właściwy stan prognozy (i NIE pisze do store przy renderze)", () => {
  it("bez prognoz: żadnej wzmianki o prognozie (komunikat nie pojawia się w niewłaściwym stanie)", () => {
    mount(createElement(LeadDetail, { leadId: "lead1", onClose: () => {} }));
    expect(container.innerHTML).not.toContain("🔮");
  });

  it("czekająca prognoza: treść + pewność + jasne „to prognoza, nie fakt”", () => {
    store.setData((d) => { d.predictionLedger = [rec()]; });
    mount(createElement(LeadDetail, { leadId: "lead1", onClose: () => {} }));
    expect(container.textContent).toContain("przerwa w kontakcie się pogłębi");
    expect(container.textContent).toContain("Pewność 70%");
    expect(container.textContent).toContain("to prognoza, nie fakt");
  });

  it("prognoza ZMIENIA się na ekranie, gdy pojawia się dowód (realna subskrypcja store→render)", () => {
    store.setData((d) => { d.predictionLedger = [rec()]; });
    mount(createElement(LeadDetail, { leadId: "lead1", onClose: () => {} }));
    expect(container.textContent).toContain("to prognoza, nie fakt");
    act(() => {
      store.setData((d) => { d.predictionLedger = [{ ...rec(), evidence: ev("correct") }]; });
    });
    expect(container.textContent).toContain("Prognoza się sprawdziła");
    expect(container.textContent).toContain("przerwa faktycznie wystąpiła");
    expect(container.textContent).not.toContain("to prognoza, nie fakt");
  });

  it("montaż teczki NIE wykonuje żadnego zapisu do store (S9: zero pracy zapisowej przy otwarciu)", () => {
    store.setData((d) => { d.predictionLedger = [rec()]; });
    const realSetData = store.setData.bind(store);
    let writes = 0;
    (store as unknown as { setData: typeof store.setData }).setData = ((fn: Parameters<typeof store.setData>[0]) => { writes++; return realSetData(fn); }) as typeof store.setData;
    try {
      mount(createElement(LeadDetail, { leadId: "lead1", onClose: () => {} }));
      expect(writes).toBe(0);
    } finally {
      (store as unknown as { setData: typeof store.setData }).setData = realSetData;
    }
  });
});

describe("Mind → sekcja Prognozy — pełna kontrola użytkownika działa KLIKNIĘCIEM", () => {
  const clickButtonWithText = (text: string) => {
    const btn = [...container.querySelectorAll("button")].find((b) => (b.textContent || "").includes(text));
    expect(btn, `brak przycisku „${text}”`).toBeTruthy();
    act(() => { btn!.click(); });
  };

  it("pokazuje aktywne prognozy z przesłankami i podsumowanie celności", () => {
    store.setData((d) => { d.predictionLedger = [rec(), { ...rec(), id: "r1", evidence: ev("correct") }]; });
    mount(createElement(Mind, { onClose: () => {} }));
    expect(container.textContent).toContain("Prognozy");
    expect(container.textContent).toContain("przewidywania, nie fakty");
    expect(container.textContent).toContain("Aktywne (czekają na termin)");
    expect(container.textContent).toContain("na podstawie: ostatni kontakt: 10 dni temu");
    expect(container.textContent).toContain("1 razy przerwa faktycznie się pogłębiła");
  });

  it("klik „Dowód błędny?” oznacza dowód i od razu pokazuje wykluczenie z uczenia", () => {
    store.setData((d) => { d.predictionLedger = [{ ...rec(), id: "r1", evidence: ev("correct") }]; });
    mount(createElement(Mind, { onClose: () => {} }));
    clickButtonWithText("Dowód błędny?");
    expect(store.data.predictionLedger![0].evidence!.disputedAt).toBeTypeOf("number");
    expect(container.textContent).toContain("oznaczone jako błędne");
  });

  it("klik „Wyczyść historię prognoz” (po potwierdzeniu) zeruje dziennik", () => {
    store.setData((d) => { d.predictionLedger = [{ ...rec(), id: "r1", evidence: ev("correct") }]; });
    const realConfirm = window.confirm;
    window.confirm = () => true;
    try {
      mount(createElement(Mind, { onClose: () => {} }));
      clickButtonWithText("Wyczyść historię prognoz");
      expect(store.data.predictionLedger).toHaveLength(0);
    } finally {
      window.confirm = realConfirm;
    }
  });

  it("checkbox wyłącza uczenie (settings.predictionLearning=false)", () => {
    store.setData((d) => { d.predictionLedger = [rec()]; });
    mount(createElement(Mind, { onClose: () => {} }));
    const box = [...container.querySelectorAll("input")].find((i) => i.type === "checkbox" && (i.parentElement?.textContent || "").includes("Ucz się"));
    expect(box).toBeTruthy();
    expect(box!.checked).toBe(true);
    act(() => {
      box!.click();
    });
    expect(store.settings.predictionLearning).toBe(false);
  });
});

describe("Agent proaktywny — prognozy widoczne bez otwierania teczki, bez spamu, we właściwym stanie", () => {
  beforeEach(() => {
    resetProactive();
    store.setSettings({ proactiveAgent: true });
  });

  it("świeża prognoza → jeden nudge z pewnością i zastrzeżeniem „to prognoza, nie fakt”, ekran sales", () => {
    store.setData((d) => { d.predictionLedger = [rec({ madeAt: Date.now() - 60_000 })]; });
    const n = nextNudge();
    expect(n?.kind).toBe("predictions");
    expect(n?.screen).toBe("sales");
    expect(n?.text).toContain("to prognoza, nie fakt");
    expect(n?.text).toContain("70%");
  });

  it("świeżo SPRAWDZONE ostrzeżenie ma pierwszeństwo i cytuje realny wynik", () => {
    store.setData((d) => {
      d.predictionLedger = [
        rec({ id: "n", madeAt: Date.now() - 60_000 }),
        { ...rec(), id: "c", entityId: "lead2", entityLabel: "Druga", evidence: ev("correct", { observedAt: Date.now() - 60_000 }) },
      ];
    });
    const n = nextNudge();
    expect(n?.kind).toBe("predictions");
    expect(n?.text).toContain("się sprawdziło");
    expect(n?.text).toContain("Druga");
  });

  it("cooldown: po pokazaniu ten sam nudge nie wraca od razu (żadnego spamu co 90 s)", () => {
    store.setData((d) => { d.predictionLedger = [rec({ madeAt: Date.now() - 60_000 })]; });
    expect(nextNudge()?.kind).toBe("predictions");
    markShown("predictions");
    expect(nextNudge()?.kind).not.toBe("predictions");
  });

  it("NIEWŁAŚCIWY stan = zero komunikatu: stare rekordy (>24 h), zakwestionowany dowód, wyłączony agent", () => {
    store.setData((d) => { d.predictionLedger = [rec({ madeAt: Date.now() - 3 * DAY })]; });
    expect(nextNudge()).toBeNull();
    store.setData((d) => {
      d.predictionLedger = [{ ...rec(), id: "c", evidence: ev("correct", { observedAt: Date.now() - 60_000, disputedAt: Date.now() - 30_000 }) }];
    });
    expect(nextNudge()).toBeNull();
    store.setData((d) => { d.predictionLedger = [rec({ madeAt: Date.now() - 60_000 })]; });
    store.setSettings({ proactiveAgent: false });
    expect(nextNudge()).toBeNull();
    store.setSettings({ proactiveAgent: true });
  });
});
