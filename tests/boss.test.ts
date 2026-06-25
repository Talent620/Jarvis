import { describe, it, expect } from "vitest";
import { isBossSummon, ROBOT_VOICE, KAPITAN_BOMBA_VOICE, bossVoiceProfile, BOSS_GREETING, bossSystem, BOSS_DOCTRINE, bossQuickActions, parseBossMeta } from "../src/lib/boss";

describe("głos Szefa — Kapitan Bomba vs Robot", () => {
  it("Kapitan Bomba jest GŁĘBSZY (niższy pitch) niż robot", () => {
    expect(KAPITAN_BOMBA_VOICE.voicePitch ?? 1).toBeLessThanOrEqual(ROBOT_VOICE.voicePitch ?? 1);
    expect(KAPITAN_BOMBA_VOICE.voiceMode).toBe("system");
  });
  it("bossVoiceProfile: domyślnie Kapitan Bomba, robot na żądanie", () => {
    expect(bossVoiceProfile(undefined)).toBe(KAPITAN_BOMBA_VOICE);
    expect(bossVoiceProfile("kapitan")).toBe(KAPITAN_BOMBA_VOICE);
    expect(bossVoiceProfile("robot")).toBe(ROBOT_VOICE);
  });
});

describe("parseBossMeta — meta-rozkazy bez modelu", () => {
  it("łapie stop/anuluj/cisza", () => {
    for (const t of ["stop", "anuluj", "przerwij", "cisza", "wystarczy", "Stop.", "zatrzymaj się"]) {
      expect(parseBossMeta(t)).toBe("stop");
    }
  });
  it("łapie powtórz/jeszcze raz", () => {
    for (const t of ["powtórz", "jeszcze raz", "powtórz to", "nie dosłyszałem"]) {
      expect(parseBossMeta(t)).toBe("repeat");
    }
  });
  it("NIE łapie normalnych poleceń", () => {
    expect(parseBossMeta("dodaj zadanie kup mleko")).toBeNull();
    expect(parseBossMeta("wyślij maila do Anny i przerwij spotkanie")).toBeNull(); // długie zdanie
    expect(parseBossMeta("")).toBeNull();
  });
});

describe("bossQuickActions — kontekstowe, kompletne rozkazy do jednego dotknięcia", () => {
  it("rano daje odprawę poranną, w ciągu dnia zwykłą", () => {
    expect(bossQuickActions(8)[0].label).toMatch(/poranna/i);
    expect(bossQuickActions(15)[0].label).toBe("Odprawa");
  });
  it("pokazuje licznik otwartych zadań; gdy brak — proponuje dodanie", () => {
    expect(bossQuickActions(10, 3).some((a) => /Zadania \(3\)/.test(a.label))).toBe(true);
    expect(bossQuickActions(10, 0).some((a) => a.label === "Dodaj zadanie")).toBe(true);
  });
  it("każdy rozkaz ma niepustą etykietę i komendę", () => {
    for (const a of bossQuickActions(9, 2)) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.command.length).toBeGreaterThan(0);
    }
  });
});

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

  it("zawiera DOKTRYNĘ (przelaną metodę): sprawdzaj-nie-zgaduj, działaj, uczciwość", () => {
    const p = bossSystem(true, "Artur");
    expect(p).toContain("DOKTRYNA");
    expect(BOSS_DOCTRINE).toMatch(/NIE ZGADUJ/);
    expect(BOSS_DOCTRINE).toMatch(/UCZCIWOŚĆ/);
    expect(BOSS_DOCTRINE).toMatch(/DZIAŁAJ/);
  });
});

describe("profil głosu robota", () => {
  it("wymusza systemowy silnik i niski ton (pitch), by brzmiał maszynowo", () => {
    expect(ROBOT_VOICE.voiceMode).toBe("system");
    expect(ROBOT_VOICE.voicePitch).toBeLessThan(1);
    expect(BOSS_GREETING.length).toBeGreaterThan(0);
  });
});
