import { describe, it, expect } from "vitest";
import { adviseError, adviseNoBrain } from "../src/lib/errorAdvisor";

// Doradca błędów: użytkownik NIGDY nie ma zostać z surowym „Internal Server Error (500)"
// i pytaniem „co teraz?". Testy pilnują: ludzki polski opis + właściwa akcja per klasa błędu.

describe("adviseError — klasy błędów mają ludzki opis i akcję", () => {
  it("REALNY PRZYPADEK użytkownika: błąd 500 → „awaria po ich stronie, nie Twoja wina” + przełącz mózg", () => {
    for (const raw of ["Internal Server Error (500)", "Błąd API (503)", "The model is overloaded. (529)"]) {
      const a = adviseError(raw);
      expect(a.human).toMatch(/awari|po ich stronie/i);
      expect(a.human).toMatch(/nie zrobiłeś nic złego|nie Twoja/i);
      expect(a.fix).toBeTruthy();
      expect(a.fix!.nav).toBe("settings");
    }
  });
  it("429/limit → odczekaj + Ponów, akcja do ⚙", () => {
    const a = adviseError("429 Too Many Requests: rate limit exceeded");
    expect(a.human).toMatch(/limit/i);
    expect(a.human).toMatch(/Ponów/);
    expect(a.fix!.nav).toBe("settings");
  });
  it("klucz (401/403/brak klucza) → prowadź do wklejenia klucza", () => {
    for (const raw of ["401 Unauthorized", "API key not valid", "Brak klucza Google Gemini (401)."]) {
      const a = adviseError(raw);
      expect(a.human).toMatch(/klucz/i);
      expect(a.fix!.label).toMatch(/klucz|Ustawienia/i);
    }
  });
  it("środki/limity konta (billing/quota) → przełącz dostawcę", () => {
    const a = adviseError("insufficient credit balance");
    expect(a.human).toMatch(/środk|limit/i);
    expect(a.fix).toBeTruthy();
  });
  it("Ollama nieosiągalna → rada humanize + akcja ⚙", () => {
    const a = adviseError("fetch http://192.168.0.10:11434 failed: connection refused");
    expect(a.human).toMatch(/Ollama/i);
    expect(a.fix).toBeTruthy();
  });
  it("sieć/timeout → rada bez przycisku ⚙ (Ponów wystarcza — w ustawieniach nic nie naprawi)", () => {
    const a = adviseError("Failed to fetch");
    expect(a.human).toMatch(/internet|połączy/i);
    expect(a.fix).toBeUndefined();
  });
  it("model nieistniejący (404) → wybierz inny model", () => {
    const a = adviseError("model gpt-9 does not exist (404)");
    expect(a.human).toMatch(/model/i);
    expect(a.fix).toBeTruthy();
  });
  it("nieznany błąd → NIGDY goły surowiec: skrócony + zawsze jakaś droga naprawy", () => {
    const junk = "XyzUnheardOfFailure: " + "a".repeat(500);
    const a = adviseError(junk);
    expect(a.human.length).toBeLessThan(260); // przycięty, nie ściana tekstu
    expect(a.human).toMatch(/Ponów|ustawie/i);
    expect(a.fix).toBeTruthy();
  });
  it("pusty/null input nie wywraca doradcy", () => {
    expect(() => adviseError("")).not.toThrow();
    expect(() => adviseError(undefined as unknown as string)).not.toThrow();
    expect(adviseError("").fix).toBeTruthy(); // nawet „nic" ma drogę naprawy
  });
});

describe("adviseNoBrain — preflight zepsutych ustawień (koniec wiecznych trzech kropek)", () => {
  it("wyjaśnia przyczynę (ustawienia/klucz) i prowadzi do ⚙ → AI", () => {
    const a = adviseNoBrain();
    expect(a.human).toMatch(/mózg|klucz/i);
    expect(a.human).toMatch(/ustawie/i);
    expect(a.fix!.nav).toBe("settings");
    expect(a.fix!.label).toMatch(/Napraw/i);
  });
});
