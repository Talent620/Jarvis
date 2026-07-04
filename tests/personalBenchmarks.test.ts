// @vitest-environment jsdom
// === Personal Intelligence Benchmark — codzienne zadania Marcina na PRAWDZIWYCH funkcjach ===
// Inne niż tests/cognitiveOrganism.test.ts (które sprawdza cały mockowany przepływ agenta).
// Tu ćwiczymy KONKRETNE codzienne zadania solo-przedsiębiorcy na produkcyjnych, czystych silnikach:
// 1) znajdź/uszereguj kandydatów wg ICP, 2) przygotuj ofertę/demo, 3) zaplanuj dzień (offline),
// 4) odpowiedz z właściwego kontekstu, 5) nigdy nie zmyślaj wykonania, 6) nigdy nie wysyłaj bez
// zgody (na PRAWDZIWYM runTool, nie na mocku), 7) degraduj się łagodnie bez internetu.
// Żadnych realnych maili/publikacji/płatności — fetch jest zatrute, sieć nigdy nie powinna paść.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { scoreLead, signalsFromLead, signalsFromCandidate } from "../src/lib/leadScoring";
import type { LeadCandidate } from "../src/lib/leadCandidates";
import { buildGrowthContext, growthContextToBrief } from "../src/lib/growthContext";
import { planDailyGrowth, actionToPlan } from "../src/lib/growthOrchestrator";
import { curateContext } from "../src/lib/contextCurator";
import { draft, attempted, confirmed, canClaimSuccess, outcomeLabel } from "../src/lib/actionOutcome";
import { riskOf, setConsentHandler, clearOutboundScope, resetConsents } from "../src/lib/permissions";
import { runTool } from "../src/lib/tools";
import { store } from "../src/lib/store";
import type { Lead, FinanceProject } from "../src/types";

const NOW = 9_000_000_000;
const DAY = 86_400_000;

describe("1. Znajdź i uszereguj kandydatów wg ICP (real scoreLead/signalsFromLead)", () => {
  it("firma bez strony z realnym budżetem wyprzedza aktywną firmę z ładną stroną, ale groszowym zleceniem", () => {
    const potrzebujeStrony: Lead = {
      id: "l1", company: "Delta Warsztat Samochodowy", status: "new", niche: "motoryzacja",
      value: 12000, email: "kontakt@delta.example", createdAt: NOW, updatedAt: NOW,
    };
    const maJuzStrone: Lead = {
      id: "l2", company: "Epsilon Software House", status: "contacted", niche: "IT",
      value: 500, email: "biuro@epsilon.example", url: "https://epsilon.example", hours: "9-17",
      followUpCount: 1, lastContactedAt: NOW - 5 * DAY, createdAt: NOW, updatedAt: NOW,
    };
    const a = scoreLead(signalsFromLead(potrzebujeStrony, NOW));
    const b = scoreLead(signalsFromLead(maJuzStrone, NOW));
    expect(a.score).toBeGreaterThan(b.score);
    expect(a.bestNextAction).toBe("demo"); // wyraźna potrzeba + dopasowanie → od razu demo
  });

  it("lead bez ŻADNEGO kontaktu nigdy nie dostaje 'offer' jako następny krok — najpierw research", () => {
    const bezKontaktu: Lead = {
      id: "l3", company: "Zeta Krawiectwo", status: "new", niche: "krawiectwo",
      value: 5000, createdAt: NOW, updatedAt: NOW, // brak email/contact/url
    };
    const r = scoreLead(signalsFromLead(bezKontaktu, NOW));
    expect(r.bestNextAction).toBe("research");
    expect(r.missingEvidence).toContain("brak potwierdzonego kontaktu");
  });

  it("kandydat PRZYKŁADOWY (mock) nie wygrywa z realnym kandydatem tylko dlatego, że ładniej wygląda", () => {
    const now = NOW;
    const real: LeadCandidate = {
      id: "osm:real", company: "Firma Realna", source: "osm", fetchedAt: now, confidence: 0.8,
      evidence: [], persistencePolicy: "persist_ok", contactability: "phone", qualityWarnings: [],
      isSample: false, phone: "123456789", address: "ul. Realna 1", niche: "usługi",
    };
    const mock: LeadCandidate = {
      id: "mock:przyklad", company: "Firma Przykładowa Sp. z o.o.", source: "mock", fetchedAt: now, confidence: 0.9,
      evidence: [], persistencePolicy: "no_persist", contactability: "email", qualityWarnings: [],
      isSample: true, email: "ladny@przyklad.example", url: "https://przyklad.example", address: "ul. Wzorcowa 1", phone: "500600700", niche: "usługi",
    };
    const scoreReal = scoreLead(signalsFromCandidate(real, now));
    const scoreMock = scoreLead(signalsFromCandidate(mock, now));
    expect(scoreReal.score).toBeGreaterThan(scoreMock.score);
  });
});

describe("2. Przygotuj ofertę/demo z prawdziwych danych leada (real buildGrowthContext)", () => {
  it("brief zawiera DOKŁADNIE wykryte problemy — nic zmyślonego, nic pominiętego", () => {
    const lead: Lead = {
      id: "l4", company: "Teta Stolarnia", status: "new", niche: "stolarstwo",
      createdAt: NOW, updatedAt: NOW, // brak url i brak e-maila → dwa konkretne problemy
    };
    const ctx = buildGrowthContext(lead);
    expect(ctx.problems).toEqual(["brak strony WWW — duża szansa na demo", "brak kontaktu e-mail w bazie"]);
    const brief = growthContextToBrief(ctx);
    expect(brief.business).toBe("Teta Stolarnia"); // nazwa firmy nie zniekształcona
    expect(brief.contact).toBeUndefined(); // brak kontaktu → NIE zmyślamy kontaktu
    expect(brief.extra).toContain("brak strony WWW");
    expect(brief.extra).not.toMatch(/HTTPS|viewport/); // te dotyczą audytu strony — leada BEZ strony nie audytujemy
  });

  it("oferta zostaje DRAFT dopóki nie zostanie realnie wysłana — nie wolno ogłosić sukcesu wcześniej", () => {
    const o = draft("oferta dla Teta Stolarnia przygotowana");
    expect(canClaimSuccess(o)).toBe(false);
    expect(outcomeLabel(o)).not.toMatch(/wysłano|wysłane/i);
  });
});

describe("3. Zaplanuj dzień z lokalnych danych — offline, maks. 3 działania (real planDailyGrowth)", () => {
  const leads: Lead[] = [
    { id: "p1", company: "Eta Ogrodnik", status: "offer", email: "eta@example.com", nextFollowUpAt: NOW - DAY, createdAt: NOW, updatedAt: NOW },
    { id: "p2", company: "Iota Fryzjer", status: "new", createdAt: NOW, updatedAt: NOW },
  ];
  const finance: FinanceProject[] = [
    { id: "f1", name: "Strona Eta", client: "Eta Ogrodnik", status: "oczekuje_platnosci", amount: 4000, paidAmount: 0, createdAt: NOW, updatedAt: NOW },
  ];

  it("zero zapytań sieciowych podczas planowania dnia — działa całkowicie offline", () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("planDailyGrowth nie powinien dotykać sieci")));
    const realFetch = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const actions = planDailyGrowth({ leads, finance, approvedPostsCount: 2, now: NOW });
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.length).toBeLessThanOrEqual(3);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });

  it("ranking malejąco wg oczekiwanej wartości — najlepsza akcja zawsze pierwsza", () => {
    const actions = planDailyGrowth({ leads, finance, approvedPostsCount: 2, now: NOW });
    for (let i = 1; i < actions.length; i++) expect(actions[i - 1].expectedValue).toBeGreaterThanOrEqual(actions[i].expectedValue);
  });

  it("każde działanie WYCHODZĄCE (wysyłka/publikacja) wymaga zgody — spójnie z prawdziwym riskOf", () => {
    const actions = planDailyGrowth({ leads, finance, approvedPostsCount: 2, now: NOW });
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      const plan = actionToPlan(a);
      const tool = plan.steps[0].tool!;
      const wantsConsent = a.requiredPermission === "consent";
      // Silnik dnia MUSI się zgadzać z prawdziwym systemem uprawnień — nie tylko z własnym zdaniem.
      expect(wantsConsent).toBe(riskOf(tool) === "outbound");
      expect(!!plan.steps[0].requiresConsent).toBe(wantsConsent);
    }
    // Sanity: w tym zestawie danych faktycznie pojawia się co najmniej jedno działanie wymagające zgody.
    expect(actions.some((a) => a.requiredPermission === "consent")).toBe(true);
  });
});

describe("4. Odpowiadaj z WŁAŚCIWEGO kontekstu, nie z szumu (real curateContext)", () => {
  it("trafny fakt wygrywa z nieistotnym szumem, nawet gdy szum jest liczniejszy i częściowo świeższy", () => {
    const candidates = [
      { text: "Adres e-mail klienta Delta: kontakt@delta.example", source: "pamięć", at: NOW - 5 * DAY, key: "delta:email", importance: 0.9 },
      { text: "Marcin lubi kawę bez cukru", source: "pamięć", at: NOW, importance: 0.2 },
      { text: "Pogoda jutro: deszcz", source: "pamięć", at: NOW, importance: 0.1 },
      { text: "Ulubiony kolor Marcina to niebieski", source: "pamięć", at: NOW, importance: 0.1 },
    ];
    const r = curateContext(candidates, { query: "jaki jest email klienta Delta", now: NOW, budgetChars: 2000 });
    expect(r.items[0].text).toMatch(/kontakt@delta\.example/);
  });

  it("sprzeczne fakty o tym samym temacie NIGDY nie są cicho zgadywane — zawsze zaznaczone", () => {
    const r = curateContext([
      { text: "Termin realizacji: 2 tygodnie", source: "lead:Delta", at: NOW - 3 * DAY, key: "delta:termin" },
      { text: "Termin realizacji: 1 miesiąc", source: "lead:Delta", at: NOW, key: "delta:termin" },
    ], { query: "jaki termin dla Delta", now: NOW, budgetChars: 1000 });
    expect(r.contradictions).toHaveLength(1);
    expect(r.contradictions[0].key).toBe("delta:termin");
  });
});

describe("5. Nigdy nie zmyślaj wykonania (real actionOutcome)", () => {
  it("cały cykl życia wysyłki oferty: DRAFT → ATTEMPTED → CONFIRMED — sukces wolno ogłosić TYLKO na końcu", () => {
    const d = draft("oferta gotowa");
    const a = attempted("gmail_send", "wysłano zapytanie do serwera pocztowego");
    const c = confirmed({ source: "gmail_send", message: "dostawca potwierdził wysyłkę" });
    expect(canClaimSuccess(d)).toBe(false);
    expect(canClaimSuccess(a)).toBe(false); // wysłane ≠ potwierdzone
    expect(canClaimSuccess(c)).toBe(true);
  });

  it("etykieta dla ATTEMPTED zawsze zawiera zastrzeżenie 'czekam na potwierdzenie' — nigdy gołego 'wysłano'", () => {
    const a = attempted("gmail_send");
    const label = outcomeLabel(a);
    expect(label).toMatch(/czeka(m)? na potwierdzenie/i);
    expect(label).not.toMatch(/^wysłano$|^opublikowano$|^opłacono$/i); // sam czasownik bez zastrzeżenia = fałszywy sukces
  });
});

describe("6. Nigdy nie wysyłaj bez zgody — prawdziwy runTool, nie mock wykonawcy", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.reject(new Error("offline test"))) as unknown as typeof fetch;
    setConsentHandler(null);
    clearOutboundScope();
    resetConsents();
    if (typeof localStorage !== "undefined") localStorage.clear();
  });
  afterEach(() => {
    global.fetch = realFetch;
    setConsentHandler(null);
    clearOutboundScope();
    delete (window as unknown as { jarvisDesktop?: unknown }).jarvisDesktop;
  });

  it("bez zgody i bez zakresu: gmail_send jest ANULOWANY — nawet z W PEŁNI skonfigurowanym SMTP", async () => {
    const sendMail = vi.fn(async () => "ok");
    (window as unknown as { jarvisDesktop: unknown }).jarvisDesktop = { sendMail };
    store.setSettings({ smtpUser: "ja@example.com", smtpPass: "haslo-aplikacji" });
    const out = await runTool("gmail_send", { to: "klient@firma.example", subject: "Oferta", body: "Dzień dobry" });
    expect(out).toMatch(/Anulowano/);
    expect(sendMail).not.toHaveBeenCalled(); // pokusa była realna (SMTP gotowy) — mimo to zero wysyłki
  });

  it("po jawnej zgodzie użytkownika (handler) — narzędzie faktycznie może wykonać krok", async () => {
    setConsentHandler(async () => ({ allow: true, remember: false }));
    const out = await runTool("gmail_send", { to: "to-nie-email", subject: "x", body: "y" });
    // Zgoda przeszła — dalej działa zwykła logika narzędzia (tu: walidacja adresu), a nie odmowa zgody.
    expect(out).not.toMatch(/Anulowano/);
  });
});

describe("7. Degraduj się łagodnie bez internetu — offline-first naprawdę działa", () => {
  it("plan dnia i ranking ICP działają identycznie z zatrutym fetch (żadna z tych funkcji nie potrzebuje sieci)", () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("brak internetu")));
    const realFetch = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const lead: Lead = { id: "o1", company: "Kappa Usługi", status: "new", niche: "usługi", value: 7000, email: "k@example.com", createdAt: NOW, updatedAt: NOW };
      const score = scoreLead(signalsFromLead(lead, NOW));
      expect(score.score).toBeGreaterThan(0);
      const actions = planDailyGrowth({ leads: [lead], finance: [], now: NOW });
      expect(Array.isArray(actions)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });
});
