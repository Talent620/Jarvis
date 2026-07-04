// === Idea Collider — codzienne twórcze połączenie (Living Intelligence Layer) ===
// CZYSTY, klient-side. Łączy DWA pozornie niezwiązane wątki z Twoich realnych danych (projekty,
// fakty z pamięci, branże leadów, notatki) w jedną iskrę kreatywną. Nie losowo — z tego, czym
// realnie żyjesz. Stałe w obrębie dnia (jedno połączenie dziennie), zmienne między dniami. S9-safe.

import type { AppData } from "../types";

export interface Collision {
  a: string;
  b: string;
  spark: string; // gotowe zaproszenie do pomyślenia
}

const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Pure: wyłuskaj kandydatów-tematy z danych użytkownika (zwięzłe, odfiltrowane, bez duplikatów). */
export function colliderTopics(d: AppData): string[] {
  const raw: string[] = [];
  for (const p of d.projects || []) if (p.name) raw.push(p.name);
  for (const m of d.memory || []) { if (m.value) raw.push(m.value); else if (m.key) raw.push(m.key); }
  for (const l of d.leads || []) if (l.niche) raw.push(l.niche);
  for (const n of (d.notes || []).slice(0, 12)) {
    const first = (n.text || "").trim().split(/\s+/).slice(0, 4).join(" ");
    if (first) raw.push(first);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const clean = t.trim().replace(/[.,;:!?]+$/, "");
    const kl = clean.toLowerCase();
    if (clean.length < 3 || clean.length > 48) continue;
    if (seen.has(kl)) continue;
    seen.add(kl);
    out.push(clean);
  }
  return out;
}

const SPARKS = [
  (a: string, b: string) => `Co by powstało, gdyby połączyć „${a}" z „${b}"? Jeden nieoczywisty pomysł na dziś.`,
  (a: string, b: string) => `„${a}" spotyka „${b}". Jaki produkt, usługa albo trik mógłby się z tego narodzić?`,
  (a: string, b: string) => `Gdyby zasady z „${a}" zastosować do „${b}" — co zyskujesz?`,
  (a: string, b: string) => `Najdziwniejszy, ale sensowny związek między „${a}" a „${b}" to…?`,
];

/** Pure: zderz dwa wątki w jedną iskrę. `dayIndex` steruje wyborem (jedno połączenie na dzień). */
export function ideaCollider(d: AppData, dayIndex: number): Collision | null {
  const topics = colliderTopics(d);
  if (topics.length < 2) return null;
  const i = ((dayIndex % topics.length) + topics.length) % topics.length;
  // Drugi temat „daleko" od pierwszego (większy dystans = bardziej nieoczywiste zderzenie).
  const j = (i + 1 + (dayIndex % (topics.length - 1))) % topics.length;
  const a = CAP(topics[i]);
  const b = CAP(topics[j === i ? (i + 1) % topics.length : j]);
  const spark = SPARKS[dayIndex % SPARKS.length](a, b);
  return { a, b, spark };
}

/** Pure: numer dnia (do stabilności „jedno połączenie dziennie"). */
export function dayNumber(now: number): number {
  return Math.floor(now / 86_400_000);
}
