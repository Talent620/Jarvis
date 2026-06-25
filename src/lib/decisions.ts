// === 🧠 Auto-capture decisions — łap decyzje i zobowiązania na bieżąco (lokalnie) ===
// Gdy w wiadomości pada decyzja albo zobowiązanie („postanowiłem…", „zdecydowałem,
// że…", „zobowiązuję się…", „muszę do piątku…"), JARVIS to wychwytuje i proponuje
// zapis do pamięci — żeby nic ważnego nie zginęło w rozmowie. Deterministyczne,
// natychmiastowe, bez modelu i bez sieci (uzupełnia AI-owe uczenie faktów).

export interface DecisionCandidate {
  statement: string; // zwięzłe brzmienie decyzji (z dużej litery)
  due?: string; // wykryty termin, jeśli był („do piątku", „jutro", „31.12")
}

// Wyzwalacze decyzji/zobowiązania. Zachowawczo — wolimy przegapić niż fałszywie alarmować.
// Uwaga: bez \b na końcu — wiele form kończy się polskim „ę/ś" (nie-ASCII), gdzie ASCII-owe
// \b nie zadziała. Frazy są na tyle charakterystyczne, że anchor nie jest potrzebny.
const TRIGGER =
  /(zdecydowa[łl](?:e|a)m|postanowi[łl](?:e|a)m|decyduj[eę] si[eę]|zobowi[aą]zuj[eę] si[eę]|deklaruj[eę]|obiecuj[eę]|umawiam si[eę]|um[oó]wmy si[eę]|wybieram|stawiam na|od (?:dzi[sś]|jutra) (?:b[eę]d[eę]|zaczynam)|musz[eę] (?:do|na))/i;

// Sygnały terminu (opcjonalne wzbogacenie).
const DUE =
  /\b(do (?:jutra|poniedzia[łl]ku|wtorku|[śs]rody|czwartku|pi[aą]tku|soboty|niedzieli|ko[ńn]ca (?:tygodnia|miesi[aą]ca|dnia)|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)|na jutro|deadline|termin\w*)\b/i;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Pure: wykryj pojedynczą decyzję/zobowiązanie w tekście. Zwraca null, gdy nic
 * pewnego nie ma (za krótko, brak wyzwalacza). Bierze zdanie z wyzwalaczem.
 */
export function detectDecision(text: string): DecisionCandidate | null {
  const t = clean(text || "");
  if (t.length < 10) return null;
  // Pytania zwykle nie są decyzjami — „czy mam zdecydować…?".
  if (/\?\s*$/.test(t) && /\b(czy|jak|kiedy|co)\b/i.test(t)) return null;

  // Rozbij na zdania i znajdź to z wyzwalaczem.
  // S9-safe: bez lookbehind (?<=…) — stary WebView Galaxy S9 by się wywalił. Zamiast tego
  // zamieniamy „koniec zdania + spację" na nową linię i dzielimy po liniach (efekt identyczny).
  const sentences = t.replace(/([.!?])\s+/g, "$1\n").split(/\n+/).map(clean).filter(Boolean);
  const hit = sentences.find((s) => TRIGGER.test(s)) || (TRIGGER.test(t) ? t : "");
  if (!hit) return null;

  const statement = cap(hit).slice(0, 200);
  const dm = hit.match(DUE);
  const due = dm ? clean(dm[0]) : undefined;
  return { statement, due };
}

/** Zwięzły klucz do pamięci (stabilny, krótki). */
export function decisionKey(d: DecisionCandidate): string {
  const base = d.statement.replace(/^(zdecydowa\w+|postanowi\w+|decyduj\w+|zobowi\w+|deklaruj\w+|obiecuj\w+)[,:\s]*/i, "");
  return ("Decyzja: " + clean(base)).slice(0, 60);
}

/** Wartość do pamięci (decyzja + termin, jeśli był). */
export function decisionValue(d: DecisionCandidate): string {
  return d.due ? `${d.statement} (termin: ${d.due})` : d.statement;
}
