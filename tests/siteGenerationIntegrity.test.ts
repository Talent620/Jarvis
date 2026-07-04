// === Integralność generowania stron (siteGenerationIntegrity) — testy ===
// Kreator NIGDY nie przyjmuje urwanej strony. Wykrywamy ucięcie ze struktury ORAZ finishReason
// (MAX_TOKENS/length), robimy najwyżej jedną próbę naprawy, a gdy się nie uda — sygnał repaired=false
// pozwala UI zachować ostatnią dobrą wersję. Płatne API są mockowane (continueFn wstrzykiwane).
import { describe, it, expect } from "vitest";
import { validateSite } from "../src/lib/siteValidator";
import { maxTokensTruncated, repairTruncatedSite } from "../src/lib/webgen";

const HEAD = `<!DOCTYPE html><html><head><title>X</title>`;
const OK = `${HEAD}</head><body><h1>Hej</h1><img src="a.jpg" alt="a"></body></html>`;

describe("finishReason → MAX_TOKENS", () => {
  it("rozpoznaje length/max_tokens/MAX_TOKENS jako ucięcie; inne = nie", () => {
    expect(maxTokensTruncated("length")).toBe(true);
    expect(maxTokensTruncated("max_tokens")).toBe(true);
    expect(maxTokensTruncated("MAX_TOKENS")).toBe(true);
    expect(maxTokensTruncated("stop")).toBe(false);
    expect(maxTokensTruncated(undefined)).toBe(false);
  });
});

describe("walidator wykrywa ucięcie", () => {
  it("brak </html> → krytyczne, nie do pobrania", () => {
    const v = validateSite(`${HEAD}</head><body><h1>Hej</h1></body>`);
    expect(v.truncated).toBe(true);
    expect(v.safeToDownload).toBe(false);
  });
  it("kompletny dokument → OK", () => {
    expect(validateSite(OK).safeToDownload).toBe(true);
  });
});

describe("repairTruncatedSite — jedna próba, uczciwy wynik", () => {
  it("urwany dokument + udana kontynuacja → repaired, do pobrania", async () => {
    const partial = `${HEAD}<style>body{color:red;`;
    const r = await repairTruncatedSite(partial, async () => "}</style></head><body><h1>Hej</h1></body></html>");
    expect(r.repaired).toBe(true);
    expect(r.validation.safeToDownload).toBe(true);
  });

  it("nieudana naprawa → repaired=false i NIEbezpieczne (UI zachowa poprzednią wersję)", async () => {
    const partial = `${HEAD}<script>function x(){`;
    const r = await repairTruncatedSite(partial, async () => "still broken (");
    expect(r.repaired).toBe(false);
    expect(r.validation.safeToDownload).toBe(false);
  });

  it("kontynuacja rzuca (np. brak sieci) → oryginał zachowany, nie do pobrania", async () => {
    const partial = `${HEAD}<style>a{`;
    const r = await repairTruncatedSite(partial, async () => { throw new Error("brak sieci"); });
    expect(r.repaired).toBe(false);
    expect(r.validation.truncated).toBe(true);
  });

  it("kompletny dokument z finishReason=length → NIE dokleja (bez korupcji), tylko flaguje maxTokens", async () => {
    let called = 0;
    const r = await repairTruncatedSite(OK, async () => { called++; return "garbage"; }, { finishReason: "length" });
    expect(called).toBe(0); // nie ruszamy kompletnego dokumentu
    expect(r.html).toBe(OK);
    expect(r.maxTokens).toBe(true);
    expect(r.validation.safeToDownload).toBe(true);
  });
});
