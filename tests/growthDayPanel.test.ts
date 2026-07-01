// === Panel „Plan dnia" — kontrakt runtime (growthDayPanel) ===
// Panel uruchamia rekomendacje przez executeGoalPlan(actionToPlan(action)). Ten test pilnuje, że
// KAŻDY rodzaj działania mapuje się na ISTNIEJĄCE narzędzie JARVIS-a, a działania zewnętrzne
// (outbound) mają w planie wymóg zgody — inaczej „Zrób" mógłby wysłać coś bez potwierdzenia.
import { describe, it, expect } from "vitest";
import { actionToPlan, type GrowthAction, type GrowthActionKind } from "../src/lib/growthOrchestrator";
import { toolDefs } from "../src/lib/tools";
import { riskOf } from "../src/lib/permissions";

const toolExists = (n: string) => toolDefs.some((d) => d.name === n);
const KINDS: GrowthActionKind[] = ["research", "build_demo", "send_followup", "publish_post", "check_payment"];

const action = (kind: GrowthActionKind, requiredPermission: "none" | "consent"): GrowthAction => ({
  id: `x:${kind}`, kind, title: `test ${kind}`, expectedValue: 1, evidence: [], cost: "", risk: "low", requiredPermission, expectedEffect: "",
});

describe("growthDayPanel — kontrakt akcji Zrob (kazde dzialanie -> realne, bezpieczne narzedzie)", () => {
  it("każdy rodzaj działania mapuje się na istniejące narzędzie JARVIS-a", () => {
    for (const kind of KINDS) {
      const plan = actionToPlan(action(kind, "none"));
      const tool = plan.steps[0].tool!;
      expect(toolExists(tool)).toBe(true);
    }
  });

  it("działania zewnętrzne (outbound) w planie wymagają zgody; bezpieczne odczyty nie", () => {
    const send = actionToPlan(action("send_followup", "consent"));
    expect(send.steps[0].requiresConsent).toBe(true);
    expect(riskOf(send.steps[0].tool!)).toBe("outbound");

    const publish = actionToPlan(action("publish_post", "consent"));
    expect(publish.steps[0].requiresConsent).toBe(true);

    const research = actionToPlan(action("research", "none"));
    expect(research.steps[0].requiresConsent).toBeUndefined();
    expect(riskOf(research.steps[0].tool!)).toBe("read");
  });

  it("plan ma cel i dokładnie jeden krok (jedno kliknięcie = jedno działanie)", () => {
    const plan = actionToPlan(action("check_payment", "none"));
    expect(plan.goal).toBeTruthy();
    expect(plan.steps).toHaveLength(1);
  });
});
