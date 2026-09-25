// Contacts with Polish inflection (mission 5.13): "Marcinowi", "Marcina", "Marcinem" -> Marcin.
// Instead of guessing a nominative from an inflected word, case forms are generated from each
// contact's name and matched against the utterance (diacritic-insensitive, small typo
// tolerance). Several matches -> the runtime asks a short question.

import { normalizeUtterance } from "./util";

export interface Contact {
  id: string;
  name: string;
  emails: string[];
  phones?: string[];
  source: string;
}

const ALTERNATION_LOC: [RegExp, string][] = [
  [/r$/, "rze"], [/t$/, "cie"], [/d$/, "dzie"], [/n$/, "nie"], [/m$/, "mie"], [/w$/, "wie"], [/b$/, "bie"],
  [/p$/, "pie"], [/s$/, "sie"], [/z$/, "zie"], [/f$/, "fie"], [/l$/, "le"], [/ł$/, "le"],
];
const FEM_LOC: [RegExp, string][] = [
  [/d$/, "dzie"], [/t$/, "cie"], [/r$/, "rze"], [/n$/, "nie"], [/ł$/, "le"], [/k$/, "ce"], [/g$/, "dze"],
  [/ch$/, "sze"], [/s$/, "sie"], [/w$/, "wie"], [/m$/, "mie"], [/b$/, "bie"], [/p$/, "pie"], [/l$/, "li"], [/z$/, "zie"],
];

function apply(rules: [RegExp, string][], stem: string, fallback: string): string {
  for (const [re, rep] of rules) if (re.test(stem)) return stem.replace(re, rep);
  return stem + fallback;
}

/** Case forms of one name token (first name or surname), lowercase with diacritics. */
export function declineName(nominative: string): string[] {
  const n = nominative.toLowerCase();
  const out = new Set<string>([n]);
  const add = (...xs: string[]) => xs.forEach((x) => out.add(x));
  if (/(ski|cki|dzki)$/.test(n)) {
    const b = n.slice(0, -1);
    add(`${b}iego`, `${b}iemu`, `${b}im`);
  } else if (/(ska|cka|dzka)$/.test(n)) {
    const b = n.slice(0, -1);
    add(`${b}iej`, `${b}ą`);
  } else if (/ia$/.test(n)) {
    const s = n.slice(0, -1); // kasi
    add(s, `${s}ę`, `${s}ą`, `${s}u`);
  } else if (/a$/.test(n)) {
    const s = n.slice(0, -1); // ann, ew, magd
    const soft = /(k|g|ch)$/.test(s);
    add(soft ? `${s}i` : `${s}y`, apply(FEM_LOC, s, "ie"), `${s}ę`, `${s}ą`, `${s}o`);
  } else if (/ek$/.test(n)) {
    const s = `${n.slice(0, -2)}k`; // tomk, mark, jack
    add(`${s}a`, `${s}owi`, `${s}iem`, `${s}u`);
  } else if (/eł$/.test(n)) {
    const s = `${n.slice(0, -2)}ł`; // pawł
    add(`${s}a`, `${s}owi`, `${s}em`, `${n.slice(0, -2)}le`);
  } else if (/(k|g)$/.test(n)) {
    add(`${n}a`, `${n}owi`, `${n}iem`, `${n}u`);
  } else if (/(sz|cz|rz|ż|j|c|ch)$/.test(n)) {
    add(`${n}a`, `${n}owi`, `${n}em`, `${n}u`);
  } else if (/[bcdfghjklłmnprstwz]$/.test(n)) {
    add(`${n}a`, `${n}owi`, `${n}em`, apply(ALTERNATION_LOC, n, "ie"), `${n}u`);
  }
  return [...out];
}

const fold = (s: string) => normalizeUtterance(s).replace(/\s+/g, "");

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function tokenMatches(token: string, forms: string[]): boolean {
  const t = fold(token);
  if (t.length < 2) return false;
  return forms.some((f) => {
    const g = fold(f);
    return g === t || (t.length >= 5 && g.length >= 5 && levenshtein(g, t) <= 1);
  });
}

const STOP_WORDS = new Set([
  "wyslij", "przeslij", "wyslac", "to", "tego", "ten", "te", "mailem", "emailem", "mejlem", "e", "mail", "maila", "smsem",
  "do", "dla", "na", "adres", "i", "a", "prosze", "jarvis", "teraz", "tez", "jeszcze", "zaznaczenie", "schowek", "tekst",
  "wiadomosc", "wiadomoscia", "napisz", "z", "ze", "od", "po", "pod",
]);

/** Candidate name tokens from an utterance ("Wyślij to mailem Marcinowi Kubickiemu" -> ["Marcinowi", "Kubickiemu"]). */
export function recipientTokens(utterance: string): string[] {
  return utterance
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ")
    .split(/[\s,.;:!?]+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(normalizeUtterance(w)) && !/^\d+$/.test(w) && !w.includes("@"));
}

/** E-mail addresses spoken or typed by the user in the instruction itself. */
export function instructionEmails(utterance: string): string[] {
  return utterance.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
}

export type ContactResolution =
  | { status: "resolved"; contact: Contact; matchedBy: string[] }
  | { status: "ambiguous"; candidates: Contact[]; question: string }
  | { status: "none"; tokens: string[] };

/** Resolve the recipient named in an utterance against the contact list. */
export function resolveContact(utterance: string, contacts: Contact[]): ContactResolution {
  const tokens = recipientTokens(utterance);
  const scored = contacts
    .map((c) => {
      const parts = c.name.split(/\s+/).filter(Boolean);
      const hits = parts.filter((p) => tokens.some((t) => tokenMatches(t, declineName(p))));
      return { c, hits };
    })
    .filter((x) => x.hits.length > 0 && x.c.emails.length > 0);
  if (!scored.length) return { status: "none", tokens };
  const best = Math.max(...scored.map((x) => x.hits.length));
  const top = scored.filter((x) => x.hits.length === best);
  if (top.length === 1) return { status: "resolved", contact: top[0].c, matchedBy: top[0].hits };
  const names = top.map((x) => x.c.name);
  return { status: "ambiguous", candidates: top.map((x) => x.c), question: `Którego: ${names.slice(0, -1).join(", ")} czy ${names[names.length - 1]}?` };
}

/** Pick one of the candidates from a short answer ("Kubickiemu", "temu drugiemu", "pierwszego"). */
export function pickCandidate(answer: string, candidates: Contact[]): Contact | null {
  const byName = resolveContact(answer, candidates);
  if (byName.status === "resolved") return byName.contact;
  const norm = normalizeUtterance(answer);
  const ord = /\b(pierwsz\w*)\b/.test(norm) ? 0 : /\b(drug\w*)\b/.test(norm) ? 1 : /\b(trzec\w*)\b/.test(norm) ? 2 : -1;
  return ord >= 0 && ord < candidates.length ? candidates[ord] : null;
}
