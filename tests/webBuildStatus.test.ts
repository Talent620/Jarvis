import { describe, it, expect, afterEach } from "vitest";
import { getWebBuild, beginWebBuild, endWebBuild, subscribeWebBuild, BUILD_STALE_MS } from "../src/lib/webBuildStatus";

// Budowa strony w tle: slot budowy żyje POZA panelem Kreatora. Testy pilnują guardu
// równoległości (dwie generacje naraz = marnowanie tokenów), przejęcia martwej budowy
// i powiadamiania subskrybentów (panel po powrocie widzi żywy stan).

const NOW = 1_700_000_000_000;

afterEach(() => endWebBuild()); // stan modułowy — sprzątaj między testami

describe("webBuildStatus — slot budowy w tle", () => {
  it("begin zajmuje slot; druga budowa w trakcie jest ODRZUCANA", () => {
    expect(beginWebBuild(false, NOW)).toBe(true);
    expect(getWebBuild().running).toBe(true);
    expect(getWebBuild().edit).toBe(false);
    expect(beginWebBuild(true, NOW + 1000)).toBe(false); // guard równoległości
    expect(getWebBuild().edit).toBe(false); // odrzucona próba NIE nadpisała stanu
  });
  it("end zwalnia slot — kolejna budowa może wystartować", () => {
    beginWebBuild(false, NOW);
    endWebBuild();
    expect(getWebBuild().running).toBe(false);
    expect(beginWebBuild(true, NOW + 5000)).toBe(true);
    expect(getWebBuild().edit).toBe(true);
  });
  it("martwą budowę (starszą niż BUILD_STALE_MS) wolno przejąć — wisząca nie blokuje na zawsze", () => {
    beginWebBuild(false, NOW);
    expect(beginWebBuild(true, NOW + BUILD_STALE_MS - 1)).toBe(false); // tuż przed progiem — nie
    expect(beginWebBuild(true, NOW + BUILD_STALE_MS)).toBe(true);      // po progu — przejęcie
    expect(getWebBuild().edit).toBe(true);
  });
  it("subskrybent dostaje powiadomienie przy begin i end; odpięcie działa", () => {
    const seen: boolean[] = [];
    const off = subscribeWebBuild(() => seen.push(getWebBuild().running));
    beginWebBuild(false, NOW);
    endWebBuild();
    expect(seen).toEqual([true, false]);
    off();
    beginWebBuild(false, NOW + 1000);
    expect(seen).toEqual([true, false]); // po odpięciu cisza
  });
  it("wyjątek w jednym słuchaczu nie zabija emitera ani innych słuchaczy", () => {
    const seen: string[] = [];
    const off1 = subscribeWebBuild(() => { throw new Error("zły słuchacz"); });
    const off2 = subscribeWebBuild(() => seen.push("ok"));
    expect(() => beginWebBuild(false, NOW)).not.toThrow();
    expect(seen).toEqual(["ok"]);
    off1(); off2();
  });
});
