import { describe, it, expect } from "vitest";
import { isPrivateModeCommand, matchUnfilteredCommand, parseReadAloud } from "../src/lib/modeCommands";

describe("parseReadAloud — odczytaj dosłownie podany tekst", () => {
  it("forma z dwukropkiem zwraca tekst po dwukropku", () => {
    expect(parseReadAloud("przeczytaj na głos: Dzień dobry, tu JARVIS")).toBe("Dzień dobry, tu JARVIS");
    expect(parseReadAloud("odczytaj mi to na głos: lista zakupów")).toBe("lista zakupów");
    expect(parseReadAloud("czytaj: cześć")).toBe("cześć");
  });
  it("bez dwukropka działa tylko z na głos i długą treścią", () => {
    const long = "x".repeat(60);
    expect(parseReadAloud("przeczytaj na głos " + long)).toBe(long);
    expect(parseReadAloud("przeczytaj na głos ostatnią wiadomość")).toBeNull(); // krótkie odwołanie, nie tekst
  });
  it("zwykła wiadomość nie jest komendą czytania", () => {
    expect(parseReadAloud("jaka jest pogoda")).toBeNull();
    expect(parseReadAloud("przeczytaj ostatnią wiadomość")).toBeNull(); // bez na głos i bez dwukropka
  });
});

describe("isPrivateModeCommand — krótka komenda tak, wklejony tekst nie", () => {
  it("łapie realne komendy", () => {
    expect(isPrivateModeCommand("włącz tryb prywatny")).toBe(true);
    expect(isPrivateModeCommand("przełącz na tryb offline")).toBe(true);
    expect(isPrivateModeCommand("działaj całkowicie prywatnie")).toBe(true);
  });
  it("NIE łapie długiego wklejonego tekstu zawierającego te słowa", () => {
    const pasted =
      "PROMPT: Zbuduj aplikację nawigacyjną. Funkcje: trwały zapis offline, " +
      "tryb offline mapy, działanie lokalnie bez sieci, prywatne dane użytkownika. " +
      "Realizuj milestone po milestone i sprawdzaj build po każdym kroku.";
    expect(pasted.length).toBeGreaterThan(100);
    expect(isPrivateModeCommand(pasted)).toBe(false);
  });
  it("przeczytaj na głos długi tekst → nie jest komendą trybu", () => {
    const read = "przeczytaj mi to na głos: " + "x".repeat(200) + " tryb offline lokalnie";
    expect(isPrivateModeCommand(read)).toBe(false);
  });
});

describe("matchUnfilteredCommand — odporne na wklejone słowo nieocenzurowany", () => {
  it("łapie krótką komendę on/off", () => {
    expect(matchUnfilteredCommand("włącz tryb bez cenzury").on).toBe(true);
    expect(matchUnfilteredCommand("przywróć filtry").off).toBe(true);
  });
  it("długi tekst ze słowem nieocenzurowany → nie przełącza", () => {
    const pasted = "Specyfikacja modelu: model jest nieocenzurowany i odpowiada wprost. " + "Szczegóły: ".repeat(20);
    expect(pasted.length).toBeGreaterThan(100);
    expect(matchUnfilteredCommand(pasted)).toEqual({ on: false, off: false });
  });
});
