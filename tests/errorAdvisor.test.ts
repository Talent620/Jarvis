import { describe, it, expect } from "vitest";
import { adviseError, adviseNoBrain, adviseEmptyReply, adviceMessage, isEmptyReplyText } from "../src/lib/errorAdvisor";

// Doradca błędów: użytkownik NIGDY nie ma zostać z surowym „Internal Server Error (500)”
// ani z gołym „…”. Każda klasa błędu daje ludzki opis + KROKI naprawy krok po kroku + akcję.

describe("adviseError — klasy błędów: opis + kroki + akcja", () => {
  it("każda porada ma niepuste kroki naprawy (krok po kroku)", () => {
    for (const raw of ["500", "429", "401", "insufficient credit", "ollama connection refused", "Failed to fetch", "model 404", "coś dziwnego"]) {
      const a = adviseError(raw);
      expect(a.steps.length, `brak kroków dla: ${raw}`).toBeGreaterThan(0);
      expect(a.human.length).toBeGreaterThan(0);
    }
  });
  it("REALNY 500 → „awaria po ich stronie, nie Twoja wina” + krok Ponów + przełącz dostawcę", () => {
    const a = adviseError("Internal Server Error (500)");
    expect(a.human).toMatch(/awari|po ich stronie/i);
    expect(a.human).toMatch(/nie zrobiłeś nic złego/i);
    expect(a.steps.join(" ")).toMatch(/Ponów/);
    expect(a.steps.join(" ")).toMatch(/dostawc/i);
    expect(a.fix!.nav).toBe("settings");
  });
  it("klucz 401 → kroki prowadzą do wklejenia klucza Gemini", () => {
    const a = adviseError("401 Unauthorized");
    expect(a.human).toMatch(/klucz/i);
    expect(a.steps.join(" ")).toMatch(/aistudio\.google\.com\/apikey/);
  });
  it("timeout/zawis (backstop) → kroki o internecie i przełączeniu dostawcy", () => {
    const a = adviseError("Odpowiedź trwała zbyt długo (przekroczono czas)");
    expect(a.human).toMatch(/zbyt długo|zerwał/i);
    expect(a.steps.join(" ")).toMatch(/internet/i);
    expect(a.fix).toBeTruthy();
  });
  it("pusty/null input nie wywraca doradcy i wciąż daje kroki + akcję", () => {
    expect(() => adviseError("")).not.toThrow();
    expect(adviseError("").steps.length).toBeGreaterThan(0);
    expect(adviseError(undefined as unknown as string).fix).toBeTruthy();
  });
});

describe("adviseEmptyReply — model odpowiedział PUSTO (samo „…”)", () => {
  it("wyjaśnia „…” i daje kroki: prostsze polecenie, model Auto, klucz", () => {
    const a = adviseEmptyReply();
    expect(a.human).toMatch(/pust/i);
    expect(a.human).toContain("…");
    expect(a.steps.join(" ")).toMatch(/Ponów/);
    expect(a.steps.join(" ")).toMatch(/Model|Auto/);
    expect(a.fix!.nav).toBe("settings");
  });
});

describe("isEmptyReplyText — rozpoznaje brak realnej treści", () => {
  it("puste / same kropki / wielokropek → true", () => {
    expect(isEmptyReplyText("")).toBe(true);
    expect(isEmptyReplyText("   ")).toBe(true);
    expect(isEmptyReplyText("…")).toBe(true);
    expect(isEmptyReplyText("...")).toBe(true);
    expect(isEmptyReplyText(". . .")).toBe(true);
    expect(isEmptyReplyText(null)).toBe(true);
    expect(isEmptyReplyText(undefined)).toBe(true);
  });
  it("realna treść → false (nawet krótka)", () => {
    expect(isEmptyReplyText("Cześć")).toBe(false);
    expect(isEmptyReplyText("Tak.")).toBe(false);
    expect(isEmptyReplyText("42")).toBe(false);
  });
});

describe("adviceMessage — składa nagłówek + numerowaną listę kroków", () => {
  it("zawiera prefiks, opis i ponumerowane kroki oddzielone nowymi liniami", () => {
    const msg = adviceMessage(adviseNoBrain());
    expect(msg).toMatch(/^⚠ /);
    expect(msg).toContain("Jak to naprawić:");
    expect(msg).toContain("1. ");
    expect(msg).toContain("2. ");
    expect(msg.split("\n").length).toBeGreaterThan(3);
  });
  it("własny prefiks jest respektowany", () => {
    expect(adviceMessage(adviseEmptyReply(), "🤔")).toMatch(/^🤔 /);
  });
});

describe("adviseNoBrain — preflight zepsutych ustawień (koniec wiecznych trzech kropek)", () => {
  it("wyjaśnia przyczynę i daje kroki do ⚙ → AI", () => {
    const a = adviseNoBrain();
    expect(a.human).toMatch(/mózg|klucz/i);
    expect(a.steps.length).toBeGreaterThan(0);
    expect(a.fix!.nav).toBe("settings");
  });
});
