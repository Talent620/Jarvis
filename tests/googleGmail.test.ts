// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { gmailReply, gmailRead, dayRangeISO, gmailUnreadSummary, gcalList, gcalAdd, gmailSend, googleBackendReady, withLocalOffset } from "../src/lib/google";
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

  it("gdy Google niepołączone → autonomicznie uruchamia łączenie (a nie suchy błąd)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Google niepołączone." }), { status: 401 })));
    // Backend jest skonfigurowany (beforeEach) → JARVIS sam otwiera autoryzację i mówi o tym wprost.
    expect(await gmailReply("a@x.pl", "T", "b")).toMatch(/łączę z kontem google|logowania|zezwól/i);
  });
});

describe("autonomiczne łączenie z Google — bez backendu", () => {
  it("gcalList bez backendu kieruje do konfiguracji (zamiast cichego błędu)", async () => {
    store.setSettings({ syncUrl: "", syncToken: "" });
    expect(googleBackendReady()).toBe(false);
    const out = await gcalList();
    expect(out).toMatch(/synchronizacja|backend/i);
    store.setSettings({ syncUrl: "https://w.workers.dev", syncToken: "tok" }); // przywróć dla kolejnych
  });
});

describe("gcalAdd — walidacja przed wysyłką (profesjonalna obsługa)", () => {
  it("odrzuca brak tytułu z czytelnym komunikatem", async () => {
    expect(await gcalAdd("", "2026-06-20T10:00:00")).toMatch(/tytuł/i);
  });
  it("odrzuca datę bez godziny (sama data) i podpowiada format ISO", async () => {
    expect(await gcalAdd("Spotkanie", "2026-06-20")).toMatch(/ISO 8601|format/i);
  });
  it("akceptuje poprawną datę ISO i potwierdza dodanie", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }))));
    expect(await gcalAdd("Spotkanie z klientem", "2026-06-20T10:00:00")).toMatch(/Dodano do Kalendarza/);
  });
  it("wysyła czas z lokalnym offsetem (godzina się nie przesuwa w kalendarzu)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await gcalAdd("X", "2026-06-20T10:00:00");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.start).toMatch(/T10:00:00([zZ]|[+-]\d{2}:\d{2})$/); // ma strefę
  });
});

describe("Kalendarz na desktopie (.exe) — routing przez mostek natywny", () => {
  afterEach(() => { delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop; });
  const setBridge = (b: unknown) => { (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop = b; };

  it("połączony mostek → gcalAdd idzie natywnie (nie przez backend)", async () => {
    const add = vi.fn(async () => ({ ok: true }));
    setBridge({ gcalList: vi.fn(), gcalAdd: add, googleStatus: async () => ({ connected: true }) });
    const out = await gcalAdd("Spotkanie", "2026-06-20T10:00:00");
    expect(add).toHaveBeenCalled();
    expect(out).toMatch(/Dodano do Kalendarza/);
  });

  it("niepołączony mostek bez danych → kieruje do ustawień (Client ID)", async () => {
    store.setSettings({ googleClientId: "", googleClientSecret: "" });
    setBridge({ gcalList: vi.fn(), gcalAdd: vi.fn(), googleStatus: async () => ({ connected: false }) });
    const out = await gcalAdd("X", "2026-06-20T10:00:00");
    expect(out).toMatch(/Client ID|Integracje/i);
  });

  it("połączony mostek → gmailSend wysyła natywnie (Gmail desktop, bez serwera)", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    setBridge({ gcalList: vi.fn(), gcalAdd: vi.fn(), gmailSend: send, gmailList: vi.fn(), googleStatus: async () => ({ connected: true }) });
    const out = await gmailSend("klient@x.pl", "Oferta", "Dzień dobry");
    expect(send).toHaveBeenCalled();
    expect(out).toMatch(/Wysłano e-mail do klient@x\.pl/);
  });
});

describe("withLocalOffset — strefa czasowa kalendarza", () => {
  it("dokłada offset do czasu bez strefy", () => {
    expect(withLocalOffset("2026-06-20T10:00:00")).toMatch(/T10:00:00([zZ]|[+-]\d{2}:\d{2})$/);
  });
  it("nie rusza czasu, który już ma strefę (Z)", () => {
    expect(withLocalOffset("2026-06-20T10:00:00Z")).toBe("2026-06-20T10:00:00Z");
  });
  it("nie rusza czasu z jawnym offsetem", () => {
    expect(withLocalOffset("2026-06-20T10:00:00+02:00")).toBe("2026-06-20T10:00:00+02:00");
  });
});

describe("dayRangeISO — zakres dnia dla kalendarza", () => {
  it("zwraca pełną dobę 00:00–24:00 dla podanego dnia", () => {
    const { timeMin, timeMax } = dayRangeISO(new Date("2026-06-15T13:37:00"));
    const min = new Date(timeMin), max = new Date(timeMax);
    expect(min.getHours()).toBe(0);
    expect(min.getMinutes()).toBe(0);
    // dokładnie 24h różnicy
    expect(max.getTime() - min.getTime()).toBe(24 * 60 * 60 * 1000);
    // ten sam dzień startu
    expect(min.getDate()).toBe(15);
  });
});

describe("gmailUnreadSummary — do briefingu", () => {
  it("liczy i wypisuje nadawców/tematy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [
      { id: "1", from: "szef@x.pl", subject: "Pilne" },
      { id: "2", from: "klient@y.pl", subject: "Faktura" },
    ] }))));
    const out = await gmailUnreadSummary();
    expect(out).toMatch(/Nieprzeczytane maile \(2\)/);
    expect(out).toContain("szef@x.pl — Pilne");
  });

  it("pusta skrzynka → komunikat o braku", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ messages: [] }))));
    expect(await gmailUnreadSummary()).toMatch(/Brak nieprzeczytanych/);
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
