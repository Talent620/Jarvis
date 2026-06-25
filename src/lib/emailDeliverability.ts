// === Agent dostarczalności e-maili (PHASE 2 — Revenue OS) ===
// Deterministyczny scoring ryzyka spamu i konwersji dla zimnego maila (temat + treść). Działa
// client-side, bez serwera. Realne SPF/DKIM/DMARC i reputacja domeny wymagają zapytań DNS/backendu
// (poza zakresem aplikacji-WebView) — tu robimy to, co da się rzetelnie ocenić z samej treści:
// słowa-wyzwalacze spamu, długość tematu, CAPS, wykrzykniki, długość treści, liczba linków, brak CTA.

export type DeliverabilityRisk = "low" | "medium" | "high";

export interface DeliverabilityResult {
  score: number; // 0–100 (wyżej = lepsza dostarczalność/jakość)
  risk: DeliverabilityRisk;
  issues: string[]; // co obniża wynik
  fixes: string[]; // konkretne poprawki
}

// Słowa, które filtry antyspamowe (i ludzie) odbierają jako nachalną sprzedaż.
const SPAM_WORDS = [
  "gratis", "za darmo", "darmowy", "darmowa", "promocja", "wygraj", "wygrałeś", "kliknij tutaj",
  "oferta specjalna", "100%", "gwarancja", "bez ryzyka", "zarobisz", "okazja", "tylko dziś",
  "ostatnia szansa", "działaj teraz", "kup teraz", "najtańsz", "wielki rabat", "ekspresowo",
  "kredyt", "pożyczka", "viagra", "casino", "miliony", "szybki zysk",
];

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Pure: oceń zimny mail pod kątem dostarczalności i jakości. Zwraca wynik 0–100 + konkretne poprawki. */
export function scoreDeliverability(subject: string, body: string): DeliverabilityResult {
  const s = (subject || "").trim();
  const b = (body || "").trim();
  const text = `${s} ${b}`.toLowerCase();
  const issues: string[] = [];
  const fixes: string[] = [];
  let score = 100;

  const hits = SPAM_WORDS.filter((w) => text.includes(w));
  if (hits.length) {
    score -= Math.min(32, hits.length * 8);
    issues.push(`Słowa wyzwalające spam: ${hits.slice(0, 5).join(", ")}`);
    fixes.push("Zamień słowa sprzedażowe na konkret i język korzyści (co zyskuje odbiorca).");
  }

  const sl = s.length;
  if (!sl) { score -= 25; issues.push("Brak tematu."); fixes.push("Dodaj krótki, konkretny temat (ok. 30–50 znaków)."); }
  else if (sl > 60) { score -= 10; issues.push(`Temat za długi (${sl} zn.).`); fixes.push("Skróć temat do ~50 znaków — długie tematy są ucinane na mobile."); }
  else if (sl < 12) { score -= 5; issues.push("Temat bardzo krótki — może wyglądać podejrzanie."); }

  const caps = (s.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/g) || []).length;
  if (sl > 6 && caps / sl > 0.5) { score -= 12; issues.push("Temat zapisany WIELKIMI literami (CAPS)."); fixes.push("Zapisz temat normalnie — CAPS to klasyczny sygnał spamu."); }

  const exclam = (text.match(/!/g) || []).length;
  if (exclam >= 3) { score -= 8; issues.push(`Za dużo wykrzykników (${exclam}).`); fixes.push("Zostaw najwyżej jeden wykrzyknik."); }

  const words = b ? b.split(/\s+/).filter(Boolean).length : 0;
  if (!words) { score -= 30; issues.push("Pusta treść maila."); fixes.push("Napisz 60–120 słów: kontekst, jedna korzyść, jedno pytanie."); }
  else if (words > 200) { score -= 10; issues.push(`Treść długa (${words} słów).`); fixes.push("Skróć do 60–120 słów — krótkie zimne maile konwertują lepiej."); }
  else if (words < 20) { score -= 6; issues.push("Treść bardzo krótka."); }

  const links = (b.match(/https?:\/\//gi) || []).length;
  if (links >= 3) { score -= 12; issues.push(`Dużo linków (${links}).`); fixes.push("Ogranicz do maks. 1 linku — wiele linków podnosi ryzyko spamu."); }

  if (words > 0 && !/\?/.test(b)) { score -= 6; issues.push("Brak pytania/CTA w treści."); fixes.push("Zakończ jednym jasnym pytaniem lub wezwaniem do działania."); }

  // Heurystyka personalizacji — zimny mail bez śladu personalizacji łatwo wpada w spam i ginie.
  if (words > 0 && !/(imię|firm|państw|\bpan\b|\bpani\b|wasz|wasze|widzę|zauważy|u was|na stronie)/i.test(b)) {
    score -= 6;
    issues.push("Brak personalizacji (mail wygląda na masowy).");
    fixes.push("Dodaj 1 zdanie konkretnie o firmie odbiorcy (np. coś z jego strony).");
  }

  score = clamp(score);
  const risk: DeliverabilityRisk = score >= 80 ? "low" : score >= 55 ? "medium" : "high";
  return { score, risk, issues, fixes };
}

/** Pure: krótka, czytelna etykieta wyniku (do UI). */
export function deliverabilityLabel(r: DeliverabilityResult): string {
  const tag = r.risk === "low" ? "✅ niskie ryzyko" : r.risk === "medium" ? "⚠ średnie ryzyko" : "⛔ wysokie ryzyko";
  return `Dostarczalność: ${r.score}/100 — ${tag}`;
}
