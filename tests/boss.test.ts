import { describe, it, expect } from "vitest";
import { isBossSummon, ROBOT_VOICE, BOSS_GREETING, bossSystem } from "../src/lib/boss";

describe("isBossSummon — przywołanie Trybu Szefa", () => {
  it("łapie jasne wezwania", () => {
    for (const t of ["szef", "Szefie", "hej szef", "OK szef", "tryb szefa", "przywołaj szefa", "wezwij szefa", "szef!", "Szefie."]) {
      expect(isBossSummon(t)).toBe(true);
    }
  });

  it("NIE łapie zdań, w których „szef” znaczy co innego", () => {
    for (const t of ["mój szef dzwonił", "powiedz szefowi że jadę", "co u szefa", "szefkuchnia przepis", "jestem szefem firmy"]) {
      expect(isBossSummon(t)).toBe(false);
    }
  });

  it("puste / śmieci → false", () => {
    expect(isBossSummon("")).toBe(false);
    expect(isBossSummon("   ")).toBe(false);
  });
});

describe("bossSystem — persona „przewiduj i potwierdzaj”", () => {
  it("zawsze: krok po kroku + powtórz i potwierdź", () => {
    const p = bossSystem(false);
    expect(p).toMatch(/KROK PO KROKU/);
    expect(p).toMatch(/dobrze usłyszałem/i);
    expect(p).toMatch(/PRZEWIDUJESZ i POTWIERDZASZ/);
  });

  it("z imieniem proponuje konkretną wartość (np. „Wpisać: Artur?”)", () => {
    const p = bossSystem(true, "Artur");
    expect(p).toMatch(/Artur/);
    expect(p).toMatch(/Wpisać: Artur/);
    expect(p).toMatch(/Imię użytkownika: Artur/);
  });

  it("pełny dostęp → wprost pozwala wykonywać; bez niego → ostrożnie", () => {
    expect(bossSystem(true, "Artur")).toMatch(/PEŁNY DOSTĘP/);
    expect(bossSystem(false, "Artur")).toMatch(/tylko po wyraźnym/i);
  });
});

describe("profil głosu robota", () => {
  it("wymusza systemowy silnik i niski ton (pitch), by brzmiał maszynowo", () => {
    expect(ROBOT_VOICE.voiceMode).toBe("system");
    expect(ROBOT_VOICE.voicePitch).toBeLessThan(1);
    expect(BOSS_GREETING.length).toBeGreaterThan(0);
  });
});
