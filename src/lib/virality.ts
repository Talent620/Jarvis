// === Virality Optimizer — ocena potencjału wiralności posta (Creative OS / PHASE 2) ===
// Czysty, deterministyczny scoring treści social media: hook, pytanie/liczba, słowo-magnes, CTA do
// interakcji, hashtagi, emoji, skanowalność. Zwraca 0–100 + ocenę + konkretne wskazówki. Bez API.
// S9-safe: emoji wykrywamy parami surogatów / zakresami BMP (bez flagi /u).

export interface ViralityResult {
  score: number; // 0–100 (ważony)
  grade: "A" | "B" | "C" | "D";
  tips: string[]; // co poprawić (braki wg wagi)
}

const POWER = /(sekret|b[łl][ąa]d|b[łl][ęe]dy|\bjak\b|dlaczego|nigdy|zawsze|\btop\b|sprawdzon|krok po kroku|musisz|przesta[ńn]|prawda o|nie r[oó]b|oto jak|w \d+ krok)/i;
const CTA = /(komentarz|napisz w komentarz|zapisz (ten )?post|zapisz na p[óo][źz]niej|udost[ęe]pnij|obserwuj|link w bio|napisz do|sprawd[źz] link|kliknij|do[łl][aą]cz|oznacz znajom)/i;
const EMOJI = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[←-➿⬀-⯿☀-⛿]/;

/** Pure: oceń post pod kątem wiralności i zwróć wskazówki poprawy. */
export function viralityScore(text: string): ViralityResult {
  const t = (text || "").trim();
  const lines = t.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const hook = lines[0] || "";

  const checks: { ok: boolean; w: number; tip: string }[] = [
    { ok: hook.length > 0 && hook.length <= 90, w: 3, tip: "Wyostrz HOOK (pierwsza linia) — krótki, do ~80 znaków, intrygujący." },
    { ok: /\?/.test(t) || /\d/.test(hook), w: 2, tip: "Dodaj pytanie albo konkretną liczbę w haku — przyciągają uwagę." },
    { ok: POWER.test(hook) || POWER.test(t), w: 2, tip: "Użyj słowa-magnesu (np. sekret, błąd, jak, dlaczego, top)." },
    { ok: CTA.test(t), w: 3, tip: "Dodaj CTA do INTERAKCJI (komentarz / zapisz / udostępnij) — napędza zasięg." },
    { ok: /#\w/.test(t), w: 1, tip: "Dodaj 3–8 trafnych hashtagów." },
    { ok: EMOJI.test(t), w: 1, tip: "Dodaj 1–3 emoji dla rytmu (bez przesady)." },
    { ok: lines.length >= 3, w: 1, tip: "Rozbij na krótkie linie/akapity — łatwiej skanować na telefonie." },
  ];

  const total = checks.reduce((s, c) => s + c.w, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.w : 0), 0);
  const score = Math.round((got / total) * 100);
  const grade: ViralityResult["grade"] = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
  const tips = checks.filter((c) => !c.ok).sort((a, b) => b.w - a.w).map((c) => c.tip);
  return { score, grade, tips };
}
