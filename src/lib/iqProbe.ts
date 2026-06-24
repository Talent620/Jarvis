// === 🔬 Test bystrości modelu — zmierz REALNĄ inteligencję u siebie, nie z reklamy ===
// Pionierskie: zamiast wierzyć w cudze wykresy, JARVIS odpala na Twoim kluczu krótki,
// deterministycznie sprawdzalny zestaw zadań (rozumowanie, liczenie, logika, trzymanie
// się polecenia, fakty) i sam je ocenia. Wynik („zmierzone u Ciebie") jest dowodem, a nie
// opinią — i uwzględnia Twoje opóźnienia. Czyste funkcje + wstrzykiwany „caller" (testowalne).

import { loadJson, saveJson } from "./lsJson";

export interface Probe {
  id: string;
  prompt: string;
  check: (out: string) => boolean;
}

// Pomocnicze, odporne na stary WebView (bez lookbehind): liczby jako osobne tokeny.
const nums = (s: string): string[] => s.match(/\d+/g) || [];
const hasNum = (s: string, n: number): boolean => nums(s).includes(String(n));
// Pierwsze „tak/nie" jako słowo (ignoruje obudowę typu „Odpowiedź: nie.").
const yesNo = (s: string): "tak" | "nie" | "" => {
  const m = s.toLowerCase().match(/\b(tak|nie)\b/);
  return (m?.[1] as "tak" | "nie") || "";
};
const lettersOnly = (s: string): string =>
  s.replace(/[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, "").toUpperCase();

// 6 zadań o jednoznacznych, sprawdzalnych odpowiedziach.
export const PROBES: Probe[] = [
  { id: "mnozenie", prompt: "Ile to 17 × 23? Podaj samą liczbę, bez słów.", check: (o) => hasNum(o, 391) },
  { id: "ciag", prompt: "Podaj następną liczbę w ciągu: 2, 4, 8, 16, … Sama liczba.", check: (o) => hasNum(o, 32) },
  {
    id: "logika",
    prompt:
      "Wszystkie róże są kwiatami. Niektóre kwiaty więdną szybko. Czy wynika z tego LOGICZNIE, że niektóre róże więdną szybko? Odpowiedz jednym słowem: tak albo nie.",
    check: (o) => yesNo(o) === "nie",
  },
  { id: "polecenie", prompt: "Odpowiedz dokładnie jednym słowem, wielkimi literami: BANAN", check: (o) => lettersOnly(o) === "BANAN" },
  {
    id: "kolejnosc",
    prompt: "Tom jest wyższy od Anny. Anna jest wyższa od Ewy. Kto jest najniższy? Podaj samo imię.",
    check: (o) => /\bew[aęy]\b/i.test(o),
  },
  { id: "pierwsza", prompt: "Czy liczba 1 jest liczbą pierwszą? Odpowiedz jednym słowem: tak albo nie.", check: (o) => yesNo(o) === "nie" },
];

export interface IqResult {
  correct: number;
  total: number;
  pct: number; // 0–100, % poprawnych
  ms: number; // średni czas odpowiedzi (ms)
  at: number; // kiedy zmierzono
  perProbe?: { id: string; ok: boolean }[];
}

/** Ocena pojedynczego zadania (czysta) — wygodne w testach. */
export function scoreProbe(probe: Probe, output: string): boolean {
  return !!output && probe.check(output);
}

/**
 * Uruchom test: dla każdego zadania woła model (wstrzyknięty `callModel`), mierzy czas i
 * deterministycznie ocenia odpowiedź. Nie rzuca — błąd pojedynczego zadania = niezaliczone.
 */
export async function runIqProbe(
  callModel: (prompt: string) => Promise<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<IqResult> {
  let correct = 0;
  let totalMs = 0;
  const perProbe: { id: string; ok: boolean }[] = [];
  for (let i = 0; i < PROBES.length; i++) {
    const p = PROBES[i];
    onProgress?.(i + 1, PROBES.length);
    const t0 = Date.now();
    let out = "";
    try {
      out = await callModel(p.prompt);
    } catch {
      out = "";
    }
    totalMs += Date.now() - t0;
    const ok = scoreProbe(p, out);
    if (ok) correct++;
    perProbe.push({ id: p.id, ok });
  }
  const total = PROBES.length;
  return { correct, total, pct: Math.round((100 * correct) / total), ms: Math.round(totalMs / total), at: Date.now(), perProbe };
}

/** Jednozdaniowy werdykt po ludzku — łączy trafność z szybkością. */
export function verdict(pct: number, ms: number): string {
  const fast = ms < 2500;
  if (pct >= 90) return fast ? "Świetny i szybki — pewniak do wszystkiego." : "Bardzo bystry, choć nieco wolniejszy.";
  if (pct >= 70) return fast ? "Solidny i szybki — dobry do codzienności." : "Solidny do typowych zadań.";
  if (pct >= 50) return "Średnio — lepszy do prostszych rzeczy.";
  return "Słaby wynik — używaj do najprostszych zadań albo zmień model.";
}

// --- Trwałość wyników (localStorage), klucz = "provider:model" ---
const LS_KEY = "jarvis.iqResults";

export function loadIqResults(): Record<string, IqResult> {
  return loadJson<Record<string, IqResult>>(LS_KEY, {});
}
export function loadIqResult(key: string): IqResult | null {
  return loadIqResults()[key] ?? null;
}
export function saveIqResult(key: string, r: IqResult): void {
  const all = loadIqResults();
  all[key] = r;
  saveJson(LS_KEY, all);
}
