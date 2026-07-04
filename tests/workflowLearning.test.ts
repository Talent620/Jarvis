// === Nauka procedur (workflowLearning) — testy ===
// Marcin uczy JARVIS-a swojej pracy bez programowania. Sprawdzamy: wykrycie wzorca (≥3),
// brak fałszywego dopasowania, różne dane wejściowe, zgody PER KROK (nie blankietowo),
// edycję, usunięcie i BRAK zapisu sekretów/treści maili jako stałych argumentów.
import { describe, it, expect } from "vitest";
import {
  detectRepeatedWorkflow, buildProcedure, procedureToPlan, procedurePreview, editProcedure,
  removeProcedure, safeParamKeys, traceSignature, type ExecutionTrace, type WorkflowProposal,
} from "../src/lib/workflowLearning";
import { riskOf } from "../src/lib/permissions";

const NOW = 6_000_000;
const trace = (id: string, tools: string[], argKeys?: string[]): ExecutionTrace => ({ id, tools, at: NOW, argKeys });
const SEQ = ["find_leads", "lead_dossier", "lead_followup", "gmail_send"];

describe("workflowLearning — wykrywanie wzorca", () => {
  it("ta sama sekwencja ≥3 razy → propozycja procedury", () => {
    const traces = [trace("1", SEQ), trace("2", SEQ), trace("3", SEQ)];
    const p = detectRepeatedWorkflow(traces);
    expect(p).not.toBeNull();
    expect(p!.count).toBe(3);
    expect(p!.tools).toEqual(SEQ);
  });

  it("za mało powtórzeń (2) → brak propozycji", () => {
    expect(detectRepeatedWorkflow([trace("1", SEQ), trace("2", SEQ)])).toBeNull();
  });

  it("różne sekwencje → brak fałszywego dopasowania", () => {
    const traces = [trace("1", SEQ), trace("2", ["find_leads", "gmail_send"]), trace("3", ["list_tasks", "add_note"])];
    expect(detectRepeatedWorkflow(traces)).toBeNull();
  });

  it("różne dane wejściowe (inne argKeys) nie psują dopasowania sekwencji", () => {
    const traces = [trace("1", SEQ, ["city"]), trace("2", SEQ, ["city", "niche"]), trace("3", SEQ, ["city"])];
    const p = detectRepeatedWorkflow(traces);
    expect(p!.count).toBe(3);
    expect(p!.paramKeys).toEqual(expect.arrayContaining(["city", "niche"]));
  });
});

describe("workflowLearning — bezpieczeństwo (bez sekretów)", () => {
  it("safeParamKeys odrzuca sekrety i treści (token, hasło, body, treść maila)", () => {
    expect(safeParamKeys(["city", "token", "password", "body", "tresc", "niche"])).toEqual(["city", "niche"]);
  });

  it("procedura nie utrwala wartości — tylko nazwy parametrów", () => {
    const proposal: WorkflowProposal = { signature: traceSignature(SEQ), tools: SEQ, count: 3, paramKeys: ["city", "token"] };
    const proc = buildProcedure(proposal, { id: "p1", name: "Pozyskanie leada", riskOf, now: NOW });
    expect(proc.parameters).toEqual(["city"]); // token odrzucony
  });
});

describe("workflowLearning — zgody PER KROK (nie blankietowo)", () => {
  it("każdy krok outbound zachowuje requiresConsent — zgoda na jeden nie pokrywa procedury", () => {
    const proposal: WorkflowProposal = { signature: traceSignature(SEQ), tools: SEQ, count: 3, paramKeys: ["city"] };
    const proc = buildProcedure(proposal, { id: "p1", name: "Lead → mail", riskOf, now: NOW });
    const gmailStep = proc.steps.find((s) => s.tool === "gmail_send")!;
    expect(gmailStep.requiresConsent).toBe(true); // outbound → zgoda
    const readStep = proc.steps.find((s) => s.tool === "find_leads")!;
    expect(readStep.requiresConsent).toBe(false); // read → bez zgody

    const plan = procedureToPlan(proc, { city: "Kraków" }, {});
    const planGmail = plan.steps.find((s) => s.tool === "gmail_send")!;
    expect(planGmail.requiresConsent).toBe(true); // w planie nadal wymaga zgody osobno
    expect(planGmail.arguments).toEqual({ city: "Kraków" }); // tylko dozwolony parametr
  });
});

describe("workflowLearning — edycja, podgląd, usuwanie", () => {
  const proposal: WorkflowProposal = { signature: traceSignature(SEQ), tools: SEQ, count: 3, paramKeys: ["city"] };

  it("podgląd pokazuje łańcuch i parametry przed uruchomieniem", () => {
    const proc = buildProcedure(proposal, { id: "p1", name: "Lead → mail", riskOf, now: NOW });
    expect(procedurePreview(proc)).toMatch(/gmail_send \(zgoda\)/);
  });

  it("edycja i usunięcie działają lokalnie", () => {
    let list = [buildProcedure(proposal, { id: "p1", name: "Stara", riskOf, now: NOW })];
    list = editProcedure(list, "p1", { name: "Nowa" }, NOW + 1);
    expect(list[0].name).toBe("Nowa");
    list = removeProcedure(list, "p1");
    expect(list).toHaveLength(0);
  });
});
