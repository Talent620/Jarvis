// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { classifyTestResult, pctUsed, stateDot } from "../src/lib/apiStatus";

describe("status API — klasyfikacja i zużycie", () => {
  it("✅ → zielony; 429/limit → żółty; inny błąd → czerwony", () => {
    expect(classifyTestResult("✅ Claude (Anthropic): działa")).toBe("ok");
    expect(classifyTestResult("❌ Błąd API (429)")).toBe("warn");
    expect(classifyTestResult("❌ rate_limit_error: too many requests")).toBe("warn");
    expect(classifyTestResult("❌ Przekroczony limit dzienny")).toBe("warn");
    expect(classifyTestResult("❌ Nieprawidłowy klucz (401)")).toBe("err");
    expect(classifyTestResult("❌ Błąd połączenia")).toBe("err");
  });

  it("pctUsed: liczy procent zużycia okna limitu", () => {
    expect(pctUsed(50, 100)).toBe(50);
    expect(pctUsed(0, 100)).toBe(100);
    expect(pctUsed(100, 100)).toBe(0);
    expect(pctUsed(NaN, 100)).toBeUndefined(); // brak nagłówków → brak procentu
    expect(pctUsed(10, 0)).toBeUndefined();
  });

  it("kropki statusu: 🟢🟡🔴", () => {
    expect(stateDot("ok")).toBe("🟢");
    expect(stateDot("warn")).toBe("🟡");
    expect(stateDot("err")).toBe("🔴");
  });
});
