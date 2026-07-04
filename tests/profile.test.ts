import { describe, it, expect } from "vitest";
import { buildProfileBlock, hasProfile, emptyProfile } from "../src/lib/profile";

describe("profil użytkownika — wbudowana pamięć", () => {
  it("pusty profil → brak bloku", () => {
    expect(hasProfile(emptyProfile)).toBe(false);
    expect(buildProfileBlock(emptyProfile)).toBe("");
    expect(buildProfileBlock(undefined)).toBe("");
  });

  it("wypełnione pola trafiają do bloku stałej pamięci", () => {
    const block = buildProfileBlock({ ...emptyProfile, occupation: "fotograf", interests: "góry, grafika", goals: "własna galeria" });
    expect(hasProfile({ occupation: "fotograf" })).toBe(true);
    expect(block).toMatch(/STAŁA PAMIĘĆ/);
    expect(block).toMatch(/Zajęcie\/praca: fotograf/);
    expect(block).toMatch(/Zainteresowania: góry, grafika/);
    expect(block).toMatch(/Cele: własna galeria/);
    expect(block).not.toMatch(/O użytkowniku/); // about puste — pomijane
  });

  it("przycina zbyt długie pola (limit ~500 znaków)", () => {
    const long = "x".repeat(2000);
    const block = buildProfileBlock({ ...emptyProfile, about: long });
    expect(block.length).toBeLessThan(700);
  });
});
