import { describe, it, expect } from "vitest";
import { parseVoiceConsent } from "../src/lib/voiceConsent";

describe("voiceConsent — bezpieczne potwierdzenie głosowe", () => {
  it("jednoznaczne TAK akceptuje", () => {
    for (const s of ["tak", "Tak.", "potwierdzam", "zgoda", "wykonaj", "okej", "ok", "jasne", "dobrze"]) {
      expect(parseVoiceConsent(s)).toBe("yes");
    }
  });

  it("jednoznaczne NIE odrzuca", () => {
    for (const s of ["nie", "Nie!", "anuluj", "stop", "przerwij", "zostaw", "odmawiam"]) {
      expect(parseVoiceConsent(s)).toBe("no");
    }
  });

  it("słowa-akcje NIE zatwierdzają (wyślij/rób/proszę/dzwoń/dawaj/śmiało)", () => {
    for (const s of ["wyślij", "rób", "zrób", "proszę", "dzwoń", "dawaj", "śmiało"]) {
      expect(parseVoiceConsent(s)).toBe("unclear");
    }
  });

  it("echo pytania JARVIS-a nie jest zgodą", () => {
    expect(parseVoiceConsent("Wysłać SMS do kontaktu Powiedz tak albo nie")).toBe("unclear");
  });

  it("i tak i nie naraz → niejasne (nie działamy)", () => {
    expect(parseVoiceConsent("tak nie wiem")).toBe("unclear");
  });

  it("puste / bełkot → niejasne", () => {
    expect(parseVoiceConsent("")).toBe("unclear");
    expect(parseVoiceConsent("yyy eee")).toBe("unclear");
  });
});
