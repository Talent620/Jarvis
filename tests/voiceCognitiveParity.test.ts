// === Parytet poznawczy w trybach głosu (voiceCognition) — testy ===
// Marcin może odłożyć telefon i prowadzić cały proces rozmową. Sprawdzamy: komendy sterowania celem
// (rozpocznij/potwierdź/postęp/zatrzymaj/wznów/co dalej), skracanie odpowiedzi do formy głosowej,
// oraz PARYTET — ten sam tekst daje tę samą decyzję poznawczą niezależnie od trybu (czat vs głos).
import { describe, it, expect } from "vitest";
import { parseVoiceGoalCommand, shortenForVoice, voiceCognition } from "../src/lib/voiceCognition";
import { classifyCognitionLocal } from "../src/lib/cognitiveController";

describe("voiceCognition — komendy sterowania celem", () => {
  it("rozpoznaje rozpoczęcie celu i wyciąga treść", () => {
    const c = parseVoiceGoalCommand("rozpocznij cel zwiększ przychód w tym miesiącu");
    expect(c?.intent).toBe("start_goal");
    expect(c?.payload).toMatch(/zwiększ przychód/);
  });

  it("rozpoznaje potwierdzenie kroku (zgoda głosowa)", () => {
    expect(parseVoiceGoalCommand("potwierdzam")?.intent).toBe("confirm_step");
    expect(parseVoiceGoalCommand("tak, zrób to")?.intent).toBe("confirm_step");
  });

  it("rozpoznaje pytanie o postęp, pauzę, wznowienie i co dalej", () => {
    expect(parseVoiceGoalCommand("jaki postęp celu")?.intent).toBe("ask_progress");
    expect(parseVoiceGoalCommand("zatrzymaj plan")?.intent).toBe("pause_plan");
    expect(parseVoiceGoalCommand("wznów cel")?.intent).toBe("resume_plan");
    expect(parseVoiceGoalCommand("co dalej?")?.intent).toBe("what_next");
  });

  it("zwykła wypowiedź nie jest komendą celu (idzie do mózgu jak każda inna)", () => {
    expect(parseVoiceGoalCommand("opowiedz mi dowcip")).toBeNull();
    expect(parseVoiceGoalCommand("")).toBeNull();
  });
});

describe("voiceCognition — krótsze odpowiedzi głosowe", () => {
  it("usuwa markdown i przycina długie odpowiedzi", () => {
    const long = "**Podsumowanie:** " + "To jest bardzo długie zdanie. ".repeat(30);
    const s = shortenForVoice(long);
    expect(s.length).toBeLessThanOrEqual(241);
    expect(s).not.toMatch(/\*\*/);
  });

  it("krótką odpowiedź zostawia bez zmian (poza czyszczeniem)", () => {
    expect(shortenForVoice("Gotowe.")).toBe("Gotowe.");
  });
});

describe("voiceCognition — PARYTET z czatem", () => {
  it("ten sam tekst → ta sama decyzja poznawcza w głosie i w czacie", () => {
    const samples = [
      "Cześć, jak się masz?",
      "Znajdź leady w Krakowie, przygotuj ofertę i wyślij maila",
      "Sprawdź w internecie aktualne ceny stali",
      "Porównaj te dwie oferty i wskaż ryzyka",
    ];
    for (const q of samples) {
      const chat = classifyCognitionLocal(q);
      const voice = voiceCognition(q);
      expect(voice.mode).toBe(chat.mode);                       // ta sama inteligencja
      expect(voice.reasoningProfile).toBe(chat.reasoningProfile);
      expect(voice.needsTools).toBe(chat.needsTools);
    }
  });
});
