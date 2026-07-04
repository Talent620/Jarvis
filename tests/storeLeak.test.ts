// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { Store } from "../src/lib/store";

// Audyt wycieków: globalne listenery (storage/pagehide/visibilitychange) NIE mogą narastać
// przy wielokrotnym tworzeniu instancji (HMR/druga karta). Każda nowa instancja odpina poprzednią.

describe("store — brak wycieku globalnych listenerów (#multiple-add)", () => {
  const origAdd = window.addEventListener.bind(window);
  const origRem = window.removeEventListener.bind(window);
  const instances: Store[] = [];

  afterEach(() => {
    window.addEventListener = origAdd;
    window.removeEventListener = origRem;
    instances.forEach((s) => s.dispose());
    instances.length = 0;
  });

  it("druga instancja ODPINA listenery pierwszej (storage) przed podpięciem swoich", () => {
    let storageAdds = 0, storageRemoves = 0;
    window.addEventListener = ((t: string, f: EventListenerOrEventListenerObject, o?: unknown) => {
      if (t === "storage") storageAdds++;
      return origAdd(t as never, f as never, o as never);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((t: string, f: EventListenerOrEventListenerObject, o?: unknown) => {
      if (t === "storage") storageRemoves++;
      return origRem(t as never, f as never, o as never);
    }) as typeof window.removeEventListener;

    const s1 = new Store(); instances.push(s1);
    const addsAfterS1 = storageAdds;
    const removesAfterS1 = storageRemoves;

    const s2 = new Store(); instances.push(s2);
    // s2 musiał ODPIĄĆ listener s1 (anti-leak) i PODPIĄĆ swój
    expect(storageRemoves).toBe(removesAfterS1 + 1);
    expect(storageAdds).toBe(addsAfterS1 + 1);

    // Netto: po dwóch instancjach przybył dokładnie 1 listener (a nie 2)
    expect(storageAdds - storageRemoves).toBe(addsAfterS1 - removesAfterS1);
  });

  it("dispose() odpina listenery (cleanup przy zamknięciu okna)", () => {
    let storageRemoves = 0;
    window.removeEventListener = ((t: string, f: EventListenerOrEventListenerObject, o?: unknown) => {
      if (t === "storage") storageRemoves++;
      return origRem(t as never, f as never, o as never);
    }) as typeof window.removeEventListener;
    const s = new Store(); instances.push(s);
    const before = storageRemoves;
    s.dispose();
    expect(storageRemoves).toBe(before + 1);
  });
});
