import { describe, it, expect, vi } from "vitest";
import { localRefine, critiqueInstruction } from "../src/lib/localRefine";
import type { JarvisReply } from "../src/lib/providers/types";

const reply = (text: string): JarvisReply => ({ text }) as JarvisReply;

describe("localRefine — Drabina Mądrości", () => {
  it("krytyka istotnie przebudowuje odpowiedź → bierzemy poprawkę (improved)", async () => {
    const r = await localRefine({
      draft: reply("Stolica Polski to Kraków, leży nad Wisłą."),
      runCritique: () => Promise.resolve(reply("Stolicą Polski jest Warszawa, a Kraków był nią dawniej.")),
    });
    expect(r.improved).toBe(true);
    expect(r.passes).toBe(2);
    expect(r.reply.text).toMatch(/Warszawa/);
  });

  it("model zostawia ~to samo (był pewny) → zostaje draft, bez churnu", async () => {
    const draftText = "Odpowiedź szczegółowa o fotosyntezie i roli chlorofilu w liściach roślin.";
    const r = await localRefine({
      draft: reply(draftText),
      runCritique: () => Promise.resolve(reply(draftText)), // identyczna
    });
    expect(r.improved).toBe(false);
    expect(r.reply.text).toBe(draftText);
  });

  it("pusty draft → nie wywołuje krytyki", async () => {
    const crit = vi.fn(() => Promise.resolve(reply("cokolwiek")));
    const r = await localRefine({ draft: reply("   "), runCritique: crit });
    expect(r.improved).toBe(false);
    expect(r.passes).toBe(1);
    expect(crit).not.toHaveBeenCalled();
  });

  it("błąd krytyki → graceful, zostaje draft", async () => {
    const r = await localRefine({
      draft: reply("oryginalna odpowiedź lokalna o czymś konkretnym"),
      runCritique: () => Promise.reject(new Error("model padł")),
    });
    expect(r.improved).toBe(false);
    expect(r.reply.text).toMatch(/oryginalna/);
  });

  it("pusta krytyka → zostaje draft", async () => {
    const r = await localRefine({ draft: reply("treść X o kotach i psach w domu"), runCritique: () => Promise.resolve(reply("")) });
    expect(r.improved).toBe(false);
  });

  it("zachowuje metadane draftu, podmienia tylko tekst (i usage)", async () => {
    const draft = { text: "stara odpowiedź o samochodach", via: "ollama", usage: { inputTokens: 1, outputTokens: 2 } } as unknown as JarvisReply;
    const r = await localRefine({
      draft,
      runCritique: () => Promise.resolve({ text: "nowa, lepsza odpowiedź o rowerach i miastach", usage: { inputTokens: 3, outputTokens: 4 } } as unknown as JarvisReply),
    });
    expect(r.improved).toBe(true);
    expect((r.reply as unknown as { via: string }).via).toBe("ollama"); // metadane draftu zostają
    expect(r.reply.text).toMatch(/rowerach/);
  });

  it("critiqueInstruction jest niepusta i prosi o poprawioną wersję", () => {
    expect(critiqueInstruction()).toMatch(/poprawion/i);
  });
});
