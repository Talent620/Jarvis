import { describe, it, expect } from "vitest";
import { shouldFallback, isNetworkError, isKeyError, humanize, isActionRequest, PERSONAL_CUES } from "../src/lib/aiHelpers";
import { isComplex } from "../src/lib/modelRouter"; // isComplex skonsolidowane w modelRouter (jedno źródło detekcji złożoności)

describe("shouldFallback", () => {
  it("wykrywa brak środków/limit/kody statusu", () => {
    expect(shouldFallback("insufficient credit balance")).toBe(true);
    expect(shouldFallback("Rate limit exceeded")).toBe(true);
    expect(shouldFallback("Error 429 too many requests")).toBe(true);
    expect(shouldFallback("HTTP 503 unavailable")).toBe(true);
    expect(shouldFallback("credit balance is too low")).toBe(true);
    expect(shouldFallback("No endpoints found for cognitivecomputations/dolphin3.0-mistral-24b:free")).toBe(true);
    expect(shouldFallback("model not found")).toBe(true);
  });
  it("nie reaguje na zwykłe błędy", () => {
    expect(shouldFallback("coś dziwnego się stało")).toBe(false);
    expect(shouldFallback("model zwrócił pustą odpowiedź")).toBe(false);
  });
});

describe("isActionRequest — akcje (narzędzia) muszą omijać konsylium", () => {
  it("wykrywa prośby-akcje (leady, e-mail, kalendarz, dom, przypomnienia)", () => {
    expect(isActionRequest("znajdź leady oraz wyślij do nich emaile")).toBe(true); // dokładna komenda użytkownika
    expect(isActionRequest("roześlij oferty do wszystkich")).toBe(true);
    expect(isActionRequest("dodaj do kalendarza spotkanie jutro o 10")).toBe(true);
    expect(isActionRequest("przypomnij mi o lekach za godzinę")).toBe(true);
    expect(isActionRequest("włącz światło w salonie")).toBe(true);
    expect(isActionRequest("wyślij maila do Jana")).toBe(true);
    expect(isActionRequest("co mam jutro w kalendarzu")).toBe(true);
  });
  it("nie łapie zwykłych pytań do deliberacji (konsylium ma sens)", () => {
    expect(isActionRequest("porównaj plusy i minusy pracy zdalnej")).toBe(false);
    expect(isActionRequest("wyjaśnij jak działa fotosynteza")).toBe(false);
    expect(isActionRequest("jaka jest stolica Francji")).toBe(false);
  });
});

describe("błąd pustego/złego klucza Gemini (OAuth) — fallback i rotacja go łapią", () => {
  const oauth = "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.";
  it("shouldFallback i isKeyError rozpoznają błąd poświadczeń Google", () => {
    expect(shouldFallback(oauth)).toBe(true);
    expect(isKeyError(oauth)).toBe(true);
    expect(isKeyError("API key not valid. Please pass a valid API key.")).toBe(true);
  });
  it("humanize tłumaczy go na czytelną wskazówkę o kluczu Gemini", () => {
    expect(humanize(oauth)).toMatch(/Klucz Gemini/);
    expect(humanize(oauth)).toMatch(/aistudio/);
  });
});

describe("isNetworkError", () => {
  it("wykrywa błędy sieci", () => {
    expect(isNetworkError("Failed to fetch")).toBe(true);
    expect(isNetworkError("Load failed")).toBe(true);
    expect(isNetworkError("request timeout")).toBe(true);
    // Przekroczenie timeoutu (fetchTimeout → AbortController) musi liczyć się jako błąd sieci.
    expect(isNetworkError("The operation was aborted")).toBe(true);
    expect(isNetworkError("signal is aborted without reason")).toBe(true);
    // Natywny błąd Capacitor/Android przy nieosiągalnym serwerze (Ollama/Tailscale).
    expect(isNetworkError("Failed to connect to /100.64.33.7:11434")).toBe(true);
    expect(isNetworkError("Connection refused")).toBe(true);
  });
  it("ignoruje błędy niesieciowe", () => {
    expect(isNetworkError("billing problem")).toBe(false);
  });
});

describe("humanize", () => {
  it("tłumaczy błąd sieci", () => {
    expect(humanize("Failed to fetch")).toMatch(/Brak połączenia/);
  });
  it("tłumaczy nieosiągalny lokalny serwer Ollama (port 11434) na konkretną radę", () => {
    const m = humanize("Failed to connect to /100.64.33.7:11434");
    expect(m).toMatch(/Ollama/);
    expect(m).toMatch(/komputer|Tailscale|chmur/);
  });
  it("tłumaczy błąd autoryzacji", () => {
    expect(humanize("401 unauthorized")).toMatch(/Klucz API/);
  });
  it("tłumaczy brak środków", () => {
    expect(humanize("credit too low")).toMatch(/środków/);
  });
  it("przepuszcza nieznany komunikat", () => {
    expect(humanize("dziwny błąd")).toBe("dziwny błąd");
  });
});

describe("isComplex", () => {
  it("oznacza długi tekst jako złożony", () => {
    expect(isComplex("a".repeat(300))).toBe(true);
  });
  it("oznacza słowa-zadania", () => {
    expect(isComplex("napisz kod w pythonie")).toBe(true);
    expect(isComplex("zaplanuj mi tydzień")).toBe(true);
    expect(isComplex("przeanalizuj ten raport")).toBe(true);
  });
  it("krótkie proste pytanie nie jest złożone", () => {
    expect(isComplex("która godzina?")).toBe(false);
  });
});

describe("PERSONAL_CUES", () => {
  it("łapie trwałe informacje o użytkowniku", () => {
    expect(PERSONAL_CUES.test("mam na imię Marcin")).toBe(true);
    expect(PERSONAL_CUES.test("mieszkam w Warszawie")).toBe(true);
    expect(PERSONAL_CUES.test("jestem uczulony na orzechy")).toBe(true);
    expect(PERSONAL_CUES.test("moja żona ma na imię Ola")).toBe(true);
  });
  it("pomija błahe pytania/komendy", () => {
    expect(PERSONAL_CUES.test("jaka jest pogoda?")).toBe(false);
    expect(PERSONAL_CUES.test("otwórz spotify")).toBe(false);
  });
});
