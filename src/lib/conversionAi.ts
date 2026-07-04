// === Conversion AI — silnik scoringu konwersji (CRO) dla wygenerowanej strony ===
// NIEINWAZYJNY, czysty moduł: ocenia HTML pod kątem mocy SPRZEDAŻOWEJ (nie SEO — to robi auditSite).
// Deterministyczny, client-side, bez API/backendu. Zwraca wynik 0–100, ocenę literową, listę kontroli
// i priorytetowy PLAN POPRAWY. Heurystyki CRO oparte na realnych zasadach konwersji (PL + EN).

export interface ConversionCheck {
  area: string;
  ok: boolean;
  weight: number; // waga wpływu na konwersję (1–3)
  tip: string; // konkretna poprawka, gdy brak
}

export interface ConversionAudit {
  score: number; // 0–100 (ważony)
  grade: "A" | "B" | "C" | "D";
  checks: ConversionCheck[];
  topFixes: string[]; // priorytetowy plan poprawy (braki wg wagi)
}

// Słowa akcji w CTA (przyciski/linki, które realnie wzywają do działania).
const ACTION = /(skontaktuj|zam[oó]w|\bkup\b|kup teraz|wypr[oó]buj|zacznij|rozpocznij|do[łl][aą]cz|um[oó]w|zarezerwuj|pobierz|sprawd[źz]|wyce[ńn]|zadzwo[ńn]|napisz|wy[śs]lij|odbierz|get started|sign up|buy now|book a|try free|contact us|download|subscribe|request a)/i;

/** Pure: ile elementów <a>/<button> to realne CTA (zawiera słowo akcji). */
export function ctaCount(html: string): number {
  const els = (html || "").match(/<(?:a|button)\b[^>]*>[\s\S]*?<\/(?:a|button)>/gi) || [];
  return els.filter((e) => ACTION.test(e.replace(/<[^>]+>/g, " "))).length;
}

/** Pure: audyt konwersji (CRO) wygenerowanej strony. */
export function conversionAudit(html: string): ConversionAudit {
  const h = html || "";
  const text = h.replace(/<[^>]+>/g, " ").toLowerCase();
  const ctas = ctaCount(h);

  const checks: ConversionCheck[] = [
    { area: "Nagłówek z korzyścią (H1)", weight: 3, ok: /<h1[\s>][\s\S]{15,}?<\/h1>/i.test(h),
      tip: "Dodaj mocny H1 mówiący o KORZYŚCI dla klienta (co zyska), a nie samą nazwę firmy." },
    { area: "Główne CTA", weight: 3, ok: ctas >= 1,
      tip: "Dodaj wyraźny przycisk akcji wysoko na stronie (np. Umów rozmowę / Wyceń projekt)." },
    { area: "Powtórzone CTA", weight: 2, ok: ctas >= 2,
      tip: "Powtórz CTA w kilku miejscach (hero, środek, stopka) — decyzja zapada w różnych momentach." },
    { area: "Dowód społeczny (opinie/logo)", weight: 3, ok: /(opini|testimonial|review|zaufa[ło]|gwiazdk|★|recenzj|klienci m[óo]wi|polecaj)/i.test(text),
      tip: "Dodaj opinie klientów, oceny lub logo firm — to najmocniej buduje zaufanie." },
    { area: "Sygnały zaufania (gwarancja)", weight: 2, ok: /(gwarancj|bezpiecz|certyfikat|\brodo\b|zwrot|bez ryzyka|sprawdzon|ubezpiecz)/i.test(text),
      tip: "Dodaj gwarancję, zwroty lub certyfikaty — redukują ryzyko po stronie klienta." },
    { area: "Cennik / czytelna wartość", weight: 2, ok: /(cennik|\bcena\b|\bz[łl]\b|\bplan\b|pakiet|od \d)/i.test(text),
      tip: "Pokaż cenę lub zakres cen — brak ceny zwiększa tarcie i odbija leady." },
    { area: "Przechwytywanie leada", weight: 3, ok: /<form\b/i.test(h) || /(newsletter|zapisz si[ęe]|zostaw \w*mail|darmow\w+ wycen)/i.test(text),
      tip: "Dodaj prosty formularz lub zapis na newsletter, by realnie zbierać kontakty." },
    { area: "Konkret i liczby", weight: 1, ok: /\d{2,}\s*(%|\+|klient|projekt|\blat\b|\bdni\b|godzin|opinii)/i.test(text),
      tip: "Użyj konkretnych liczb (np. 250+ klientów, 7 dni) — uwiarygadniają obietnice." },
    { area: "Język korzyści", weight: 2, ok: /(zysk|oszcz[ęe]d|wi[ęe]cej klient|zar[oa]bi|szybciej|bez stresu|rozwi[ąa]z|dzi[ęe]ki temu|pomo[żz]e)/i.test(text),
      tip: "Pisz o EFEKCIE dla klienta (co zyska), nie tylko o cechach usługi." },
    { area: "FAQ (zbijanie obiekcji)", weight: 1, ok: /<details\b/i.test(h) || /\bfaq\b|cz[ęe]sto zadawane/i.test(text),
      tip: "Dodaj FAQ — rozwiewa wątpliwości tuż przed decyzją zakupową." },
    { area: "Wyraźny kontakt", weight: 1, ok: /(kontakt|tel\.|telefon|@|napisz do nas|zadzwo)/i.test(text),
      tip: "Ułatw kontakt: widoczny telefon, e-mail lub przycisk kontaktu." },
  ];

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = Math.round((got / total) * 100);
  const grade: ConversionAudit["grade"] = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
  const topFixes = checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight).map((c) => c.tip).slice(0, 4);
  return { score, grade, checks, topFixes };
}

/** Pure: instrukcja edycji dla generatora, by PODNIEŚĆ konwersję wg braków z audytu. */
export function conversionFixInstruction(audit: ConversionAudit): string {
  const fixes = audit.topFixes.length ? audit.topFixes : ["Wzmocnij nagłówek, CTA i dowód społeczny."];
  return [
    "Wciel się w eksperta CRO (optymalizacja konwersji). Podnieś SPRZEDAŻOWĄ skuteczność tej strony,",
    "wprowadzając PRZEDE WSZYSTKIM poniższe poprawki (zachowaj spójny styl i wysoki poziom wizualny):",
    ...fixes.map((f) => `• ${f}`),
    "Nie usuwaj dobrych elementów. Zwróć pełną, ulepszoną wersję strony.",
  ].join("\n");
}
