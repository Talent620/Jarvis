// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { gmailReply, gmailRead } from "../src/lib/google";
import { store } from "../src/lib/store";

// Integracja Gmail przez backend: odpowiedź w wątku i czytanie pełnej treści.
beforeEach(() => store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok" }));
afterEach(() => vi.unstubAllGlobals());

describe("gmailReply — odpowiedź w wątku", () => {
  it("dodaje prefiks Re: i przekazuje threadId + inReplyTo", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    const msg = await gmailReply("klient@x.pl", "Oferta", "Dziękuję", "T123", "<abc@mail>");
    expect(msg).toMatch(/Wysłano odpowiedź/);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toBe("Re: Oferta");
    expect(body.threadId).toBe("T123");
    expect(body.inReplyTo).toBe("<abc@mail>");
  });

  it("nie dubluje Re: gdy temat już je ma", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await gmailReply("a@x.pl", "RE: Cześć", "ok");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subject).toBe("RE: Cześć");
  });

  it("błąd backendu przekazany czytelnie", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Google niepołączone." }), { status: 401 })));
    expect(await gmailReply("a@x.pl", "T", "b")).toMatch(/niepołączone/);
  });
});

describe("gmailRead — pełna treść", () => {
  it("formatuje nadawcę, temat i treść", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "m1", threadId: "t1", from: "szef@x.pl", subject: "Pilne", body: "Zadzwoń", messageId: "<x@m>" }))));
    const out = await gmailRead("m1");
    expect(out).toContain("szef@x.pl");
    expect(out).toContain("Pilne");
    expect(out).toContain("Zadzwoń");
    expect(out).toContain("threadId=t1");
  });
});
