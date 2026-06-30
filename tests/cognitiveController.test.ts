// === Kontroler poznawczy — testy lokalnej klasyfikacji + eskalacji ===
// Sprawdza, że JEDEN kontroler poprawnie rozpoznaje sposób działania (rozmowa, research, prosta
// akcja, cel wieloetapowy, obraz, niejednoznaczność) BEZ żadnego API — a Gemini structured
// uruchamia się WYŁĄCZNIE przy niskiej pewności (mockowany hak). Zero płatnego API.
import { describe, it, expect, vi } from "vitest";
import { classifyCognitionLocal, decideCognition, riskFromText, LOW_CONFIDENCE } from "../src/lib/cognitiveController";

describe("cognitiveController — lokalna klasyfikacja trybu", () => {
  it("rozmowa → respond, bez narzędzi, bez researchu", () => {
    const d = classifyCognitionLocal("Cześć, jak się masz?");
    expect(d.mode).toBe("respond");
    expect(d.needsTools).toBe(false);
    expect(d.needsCurrentData).toBe(false);
  });

  it("research → potrzebne aktualne dane (needsCurrentData)", () => {
    const d = classifyCognitionLocal("Sprawdź w internecie aktualne ceny stali");
    expect(d.mode).toBe("research");
    expect(d.needsCurrentData).toBe(true);
  });

  it("prosta akcja → single_action, narzędzia, ryzyko write (lokalny zapis)", () => {
    const d = classifyCognitionLocal("Dodaj zadanie: zadzwonić do księgowej");
    expect(d.mode).toBe("single_action");
    expect(d.needsTools).toBe(true);
    expect(d.risk).toBe("write");
  });

  it("akcja zewnętrzna → ryzyko outbound + wymaga weryfikacji", () => {
    const d = classifyCognitionLocal("Wyślij maila do klienta z ofertą");
    expect(d.mode).toBe("single_action");
    expect(d.risk).toBe("outbound");
    expect(d.needsVerification).toBe(true);
  });

  it("cel wieloetapowy → multi_step_goal, narzędzia, weryfikacja, high", () => {
    const d = classifyCognitionLocal("Znajdź leady w Krakowie, przygotuj ofertę i wyślij maila");
    expect(d.mode).toBe("multi_step_goal");
    expect(d.needsTools).toBe(true);
    expect(d.needsVerification).toBe(true);
    expect(d.reasoningProfile).toBe("high");
  });

  it("obraz → vision (profil medium)", () => {
    const d = classifyCognitionLocal("co to?", { hasImage: true });
    expect(d.mode).toBe("vision");
    expect(d.reasoningProfile).toBe("medium");
  });

  it("niejednoznaczne → clarify (niska pewność, profil minimal)", () => {
    const d = classifyCognitionLocal("zrób to");
    expect(d.mode).toBe("clarify");
    expect(d.confidence).toBeLessThan(LOW_CONFIDENCE);
    expect(d.reasoningProfile).toBe("minimal");
  });

  it("analiza/porównanie → analyze, high, sięga po pamięć", () => {
    const d = classifyCognitionLocal("Porównaj te dwie oferty i wskaż ryzyka");
    expect(d.mode).toBe("analyze");
    expect(d.reasoningProfile).toBe("high");
    expect(d.needsMemory).toBe(true);
  });

  it("riskFromText: outbound > write > read", () => {
    expect(riskFromText("wyślij sms")).toBe("outbound");
    expect(riskFromText("zapisz notatkę")).toBe("write");
    expect(riskFromText("ile to jest 2+2")).toBe("read");
  });
});

describe("cognitiveController — eskalacja TYLKO przy niskiej pewności", () => {
  it("jasne pytanie NIE uruchamia structured classification (zero dodatkowych wywołań API)", async () => {
    const escalate = vi.fn(async () => ({ mode: "analyze" as const, confidence: 0.9 }));
    const d = await decideCognition("Jaka jest stolica Polski?", { escalate });
    expect(escalate).not.toHaveBeenCalled();
    expect(d.mode).toBe("respond");
  });

  it("niska pewność → wywołuje hak i SCALA wynik modelu", async () => {
    const escalate = vi.fn(async () => ({ mode: "single_action" as const, confidence: 0.88 }));
    const d = await decideCognition("zrób to", { escalate });
    expect(escalate).toHaveBeenCalledTimes(1);
    expect(d.mode).toBe("single_action");
    expect(d.needsTools).toBe(true); // przeliczone spójnie po scaleniu
  });

  it("eskalacja pada (sieć/quota) → bezpiecznie zostaje decyzja lokalna", async () => {
    const escalate = vi.fn(async () => { throw new Error("429"); });
    const d = await decideCognition("zrób to", { escalate });
    expect(d.mode).toBe("clarify");
  });

  it("bez haka escalate przy niskiej pewności → tylko wynik lokalny (brak API)", async () => {
    const d = await decideCognition("zrób to");
    expect(d.mode).toBe("clarify");
  });
});
