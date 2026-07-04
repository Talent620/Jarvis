// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { approveHandoff, continueMissionWithConsent } from "../src/lib/horizon/handoffConsent";
import { runMission, initMissionState, type NodeExecutor } from "../src/lib/horizon/missionRelay";
import { setConsentHandler, setAutoConsent, grantOutboundScope, clearOutboundScope, type ConsentRequest } from "../src/lib/permissions";
import { store } from "../src/lib/store";
import type { Mission, MissionStep } from "../src/lib/horizon/types";

// Karta Przekazania przez ZNANY dialog zgód — z twardszymi regułami niż outbound:
// zgoda jednorazowa (nigdy pamiętana), auto-zgoda/zakres sesyjny NIE omijają Karty,
// brak UI = misja uczciwie czeka (fail-closed), każda decyzja w audycie.

const NOW = 1_700_000_000_000;

const paymentMission = (id = "m1"): Mission => ({
  id,
  title: "Opłać fakturę",
  createdAt: NOW,
  steps: [
    { id: "s1", node: "exe", capability: "pay_invoice", correlationId: id + "-c1", hardStop: "payment", expect: { paid: true } } as MissionStep,
  ],
});

const okExec: NodeExecutor = async (step) => ({ actuated: true, readback: step.expect });

beforeEach(() => {
  setConsentHandler(null);
  setAutoConsent(false);
  clearOutboundScope();
});
afterEach(() => {
  setConsentHandler(null);
  setAutoConsent(false);
  clearOutboundScope();
});

describe("approveHandoff — twarda granica przez dialog zgód", () => {
  it("brak UI zgody → odmowa (fail-closed) + wpis audytu o wstrzymaniu", async () => {
    const r1 = await runMission(initMissionState(paymentMission()), [], okExec, { now: NOW });
    expect(r1.state.status).toBe("awaiting_human");

    const allow = await approveHandoff(r1.state.pendingHandoff!);
    expect(allow).toBe(false);
    expect(store.data.audit[0].tool).toBe("mission_handoff");
    expect(store.data.audit[0].status).toBe("denied");
    expect(String(store.data.audit[0].output)).toMatch(/fail-closed|wstrzymana/);
  });

  it("auto-zgoda Trybu Szefa i zakres sesyjny NIE omijają Karty (surowsze niż outbound)", async () => {
    setAutoConsent(true); // wystarcza dla zwykłego outbound…
    grantOutboundScope("*"); // …i to też — ale NIE dla twardej granicy STOP
    const r1 = await runMission(initMissionState(paymentMission()), [], okExec, { now: NOW });
    const allow = await approveHandoff(r1.state.pendingHandoff!);
    expect(allow).toBe(false); // bez JAWNEJ decyzji człowieka w dialogu — odmowa
  });

  it("„zapamiętaj” z dialogu jest ignorowane — każda Karta pyta OD NOWA", async () => {
    let asks = 0;
    setConsentHandler(async (_req: ConsentRequest) => {
      asks += 1;
      return { allow: true, remember: true }; // użytkownik prosi o zapamiętanie…
    });
    const m1 = await runMission(initMissionState(paymentMission("mA")), [], okExec, { now: NOW });
    expect(await approveHandoff(m1.state.pendingHandoff!)).toBe(true);

    const m2 = await runMission(initMissionState(paymentMission("mB")), [], okExec, { now: NOW });
    expect(await approveHandoff(m2.state.pendingHandoff!)).toBe(true);
    expect(asks).toBe(2); // …ale płatność to decyzja jednorazowa: drugie pytanie PADŁO
  });
});

describe("continueMissionWithConsent — pełny przepływ Karty", () => {
  it("zatwierdzenie w dialogu → misja wykonuje krok STOP i domyka się", async () => {
    setConsentHandler(async (req: ConsentRequest) => {
      expect(req.tool).toBe("mission_handoff_payment");
      expect(String(req.input)).toMatch(/Płatność/);
      return { allow: true, remember: false };
    });
    const r1 = await runMission(initMissionState(paymentMission()), [], okExec, { now: NOW });
    const r2 = await continueMissionWithConsent(r1.state, r1.ledger, okExec, { now: NOW + 1 });
    expect(r2.asked).toBe(true);
    expect(r2.state.status).toBe("done");
    expect(r2.state.results.s1.outcome.state).toBe("CONFIRMED");
    expect(r2.state.pendingHandoff).toBeUndefined();
  });

  it("odmowa w dialogu → misja UCZCIWIE zostaje awaiting_human, krok niewykonany", async () => {
    setConsentHandler(async () => ({ allow: false, remember: false }));
    let executed = 0;
    const countingExec: NodeExecutor = async (step) => {
      executed += 1;
      return { actuated: true, readback: step.expect };
    };
    const r1 = await runMission(initMissionState(paymentMission()), [], countingExec, { now: NOW });
    const r2 = await continueMissionWithConsent(r1.state, r1.ledger, countingExec, { now: NOW + 1 });
    expect(r2.asked).toBe(true);
    expect(r2.state.status).toBe("awaiting_human");
    expect(executed).toBe(0); // płatność NIE ruszyła
  });

  it("misja bez oczekującej Karty → no-op (asked=false, stan bez zmian)", async () => {
    const steps: MissionStep[] = [
      { id: "s1", node: "phone", capability: "prepare", correlationId: "c1", expect: { ready: true } },
    ];
    const m: Mission = { id: "mZ", title: "Zwykła", createdAt: NOW, steps };
    const r1 = await runMission(initMissionState(m), [], okExec, { now: NOW });
    expect(r1.state.status).toBe("done");
    const r2 = await continueMissionWithConsent(r1.state, r1.ledger, okExec, { now: NOW + 1 });
    expect(r2.asked).toBe(false);
    expect(r2.state).toBe(r1.state);
  });
});
