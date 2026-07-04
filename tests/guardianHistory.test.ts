import { describe, it, expect } from "vitest";
import { appendEvent, topFixes, recurringHint, type GuardianEvent } from "../src/lib/guardianHistory";

const ev = (message: string, kind: GuardianEvent["kind"] = "fix", at = Date.now()): GuardianEvent => ({ at, kind, message });

describe("guardianHistory — appendEvent", () => {
  it("dokłada na początek i przycina do limitu", () => {
    let list: GuardianEvent[] = [];
    for (let i = 0; i < 25; i++) list = appendEvent(list, ev(`napr ${i}`, "fix", 1000 + i), 20);
    expect(list.length).toBe(20);
    expect(list[0].message).toBe("napr 24"); // najnowsze pierwsze
  });
  it("nie dubluje tej samej wiadomości w ciągu 5 s", () => {
    const t = 10_000;
    let list = appendEvent([], ev("to samo", "fix", t));
    list = appendEvent(list, ev("to samo", "fix", t + 1000));
    expect(list.length).toBe(1);
  });
  it("ta sama wiadomość po >5 s już wchodzi", () => {
    const t = 10_000;
    let list = appendEvent([], ev("powtórka", "fix", t));
    list = appendEvent(list, ev("powtórka", "fix", t + 6000));
    expect(list.length).toBe(2);
  });
});

describe("guardianHistory — topFixes", () => {
  it("zlicza najczęstsze naprawy malejąco", () => {
    const list = [ev("A"), ev("B"), ev("A"), ev("A"), ev("C", "recommend")];
    const top = topFixes(list, 3);
    expect(top[0]).toEqual({ message: "A", count: 3 });
    expect(top.find((t) => t.message === "C")).toBeUndefined(); // tylko kind=fix
  });
});

describe("guardianHistory — recurringHint", () => {
  it("naprawa < min razy → brak podpowiedzi", () => {
    expect(recurringHint([ev("🔗 Połącz serwery"), ev("🔗 Połącz serwery")], 3)).toBeNull();
  });
  it("nawracająca naprawa serwera → trwała rada o autostarcie Ollamy", () => {
    const list = [ev("🔗 Połączono Ollama"), ev("🔗 Połączono Ollama"), ev("🔗 Połączono Ollama")];
    const h = recurringHint(list, 3);
    expect(h?.count).toBe(3);
    expect(h?.advice).toMatch(/autostart|Ollama/i);
  });
  it("nawracający głos → rada o przypięciu głosu", () => {
    const list = [ev("🇵🇱 Naprawiono głos"), ev("🇵🇱 Naprawiono głos"), ev("🇵🇱 Naprawiono głos")];
    expect(recurringHint(list, 3)?.advice).toMatch(/przypnij|głos/i);
  });
});
