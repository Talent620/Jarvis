import { describe, it, expect, beforeEach } from "vitest";
import { store } from "../src/lib/store";
import { keyList, keyCount, primaryKey, orderedKeys, coolDownKey, isCoolingDown, isTavilyKey } from "../src/lib/keys";
import { isKeyError } from "../src/lib/aiHelpers";

describe("isTavilyKey — rozpoznanie klucza research", () => {
  it("klucz Tavily (tvly-) → true; inne → false", () => {
    expect(isTavilyKey("tvly-abc123")).toBe(true);
    expect(isTavilyKey("TVLY-XYZ")).toBe(true);
    expect(isTavilyKey("  tvly-pad ")).toBe(true);
    expect(isTavilyKey("sk-ant-123")).toBe(false);
    expect(isTavilyKey("AIzaSyXXX")).toBe(false);
    expect(isTavilyKey("")).toBe(false);
  });
});

describe("keyList — wiele kluczy na dostawcę", () => {
  beforeEach(() => {
    store.setSettings({ keys: { ...store.settings.keys, gemini: "", groq: "" } });
  });

  it("dzieli po nowej linii i przecinku, przycina i usuwa duplikaty", () => {
    store.setSettings({ keys: { ...store.settings.keys, gemini: "AAA\n BBB ,AAA\n\nCCC" } });
    expect(keyList("gemini")).toEqual(["AAA", "BBB", "CCC"]);
    expect(keyCount("gemini")).toBe(3);
  });

  it("pusty/whitespace → brak kluczy", () => {
    store.setSettings({ keys: { ...store.settings.keys, gemini: "   \n  " } });
    expect(keyList("gemini")).toEqual([]);
    expect(primaryKey("gemini")).toBe("");
  });

  it("primaryKey zwraca pierwszy klucz", () => {
    store.setSettings({ keys: { ...store.settings.keys, groq: "K1\nK2" } });
    expect(primaryKey("groq")).toBe("K1");
  });
});

describe("rotacja przez cooldown", () => {
  beforeEach(() => {
    store.setSettings({ keys: { ...store.settings.keys, groq: "K1\nK2\nK3" } });
  });

  it("klucz w cooldownie ląduje na końcu kolejki, świeży idzie pierwszy", () => {
    coolDownKey("groq", "K1");
    expect(isCoolingDown("groq", "K1")).toBe(true);
    const ordered = orderedKeys("groq");
    expect(ordered[0]).toBe("K2"); // świeży pierwszy
    expect(ordered[ordered.length - 1]).toBe("K1"); // wyczerpany ostatni
    expect(primaryKey("groq")).toBe("K2"); // pojedyncze wywołania omijają wyczerpany
  });
});

describe("isKeyError — kiedy rotować na kolejny klucz", () => {
  it("łapie limity i autoryzację", () => {
    expect(isKeyError("Rate limit exceeded")).toBe(true);
    expect(isKeyError("429 too many requests")).toBe(true);
    expect(isKeyError("quota exceeded")).toBe(true);
    expect(isKeyError("401 unauthorized")).toBe(true);
  });
  it("nie łapie zwykłych błędów (zostają dla fallbacku dostawcy)", () => {
    expect(isKeyError("model not found")).toBe(false);
    expect(isKeyError("Failed to fetch")).toBe(false);
  });
});
