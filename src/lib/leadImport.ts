import { store, uid } from "./store";
import type { Lead } from "../types";

// Import leadów z wklejonego tekstu/CSV. Obsługuje:
//  - CSV/średnikowe/tabowane z nagłówkiem (Firma, Telefon, E-mail, Miasto, Notatka),
//  - proste listy „jedna firma na linię",
//  - wiersze typu „Firma, 600100200, biuro@firma.pl, Kraków".
// Czysty parser (parseLeadsImport) — w pełni testowalny.

export interface ImportRow {
  company: string;
  phone?: string;
  email?: string;
  url?: string;
  city?: string;
  note?: string;
}

const PHONE_RE = /(?:\+?\d[\d\s-]{7,}\d)/;
const EMAIL_RE = /[^\s,;]+@[^\s,;]+\.[^\s,;]+/;
const URL_RE = /\b((https?:\/\/)?[a-z0-9-]+\.[a-z]{2,}(\/\S*)?)\b/i;

/** Wykryj separator kolumn (najczęstszy w pierwszej linii z danymi). */
function detectDelim(line: string): string {
  const counts: Record<string, number> = { ";": (line.match(/;/g) || []).length, "\t": (line.match(/\t/g) || []).length, ",": (line.match(/,/g) || []).length };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : "";
}

const norm = (s: string) => s.trim().replace(/^["']|["']$/g, "").trim();
// Etykieta nagłówka = DOKŁADNIE jedno ze słów-kluczy (nie „Firma X" — to nazwa).
const HEADER_LABEL = /^(firma|nazwa|company|name|telefon|phone|tel|e-?mail|email|miasto|city|lokalizacja|strona|www|url|notatka|uwagi|note)$/i;
const isHeader = (cells: string[]) => {
  const labels = cells.filter((c) => HEADER_LABEL.test(norm(c))).length;
  const looksLikeData = cells.some((c) => EMAIL_RE.test(c) || PHONE_RE.test(c));
  return labels >= 2 && !looksLikeData; // ≥2 etykiety i żadna komórka to nie dane
};

/** Zmapuj kolumny po nagłówku (lub heurystycznie, gdy brak nagłówka). */
function mapByHeader(header: string[]): (cells: string[]) => ImportRow {
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h));
  const ci = idx(/firma|nazwa|company/i), pi = idx(/telefon|phone|tel/i),
    ei = idx(/e-?mail/i), ui = idx(/strona|www|url|http/i),
    mi = idx(/miasto|city|lokaliz/i), ni = idx(/notat|uwag|note/i);
  return (cells) => ({
    company: norm(cells[ci >= 0 ? ci : 0] || ""),
    phone: pi >= 0 ? norm(cells[pi] || "") || undefined : undefined,
    email: ei >= 0 ? norm(cells[ei] || "") || undefined : undefined,
    url: ui >= 0 ? norm(cells[ui] || "") || undefined : undefined,
    city: mi >= 0 ? norm(cells[mi] || "") || undefined : undefined,
    note: ni >= 0 ? norm(cells[ni] || "") || undefined : undefined,
  });
}

/** Heurystyka: rozpoznaj telefon/e-mail/stronę w komórkach, reszta → nazwa. */
function smartRow(cells: string[]): ImportRow {
  const row: ImportRow = { company: "" };
  const rest: string[] = [];
  for (const cell of cells.map(norm).filter(Boolean)) {
    if (!row.email && EMAIL_RE.test(cell)) { row.email = EMAIL_RE.exec(cell)![0]; continue; }
    if (!row.phone && PHONE_RE.test(cell) && !/[a-ząćęłńóśźż]/i.test(cell)) { row.phone = cell; continue; }
    if (!row.url && /\.(pl|com|eu|net|org|info)\b/i.test(cell) && URL_RE.test(cell) && !EMAIL_RE.test(cell)) { row.url = URL_RE.exec(cell)![1]; continue; }
    rest.push(cell);
  }
  row.company = rest.shift() || "";
  if (rest.length) row.city = rest.join(", ");
  return row;
}

/** Sparsuj wklejony tekst na wiersze importu (czysta funkcja). */
export function parseLeadsImport(text: string): ImportRow[] {
  const lines = (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delim = detectDelim(lines[0]) || (lines.find((l) => detectDelim(l)) ? detectDelim(lines.find((l) => detectDelim(l))!) : "");
  const split = (l: string) => (delim ? l.split(delim) : [l]);

  let mapper = smartRow;
  let start = 0;
  if (delim) {
    const first = split(lines[0]).map(norm);
    if (isHeader(first)) { mapper = mapByHeader(first); start = 1; }
  }
  const out: ImportRow[] = [];
  for (let i = start; i < lines.length; i++) {
    const row = mapper(split(lines[i]));
    if (row.company) out.push(row);
  }
  return out;
}

/** Zapisz zaimportowane leady (dedup po nazwie). Zwraca liczbę dodanych. */
export function importLeads(text: string): { added: number; total: number } {
  const rows = parseLeadsImport(text);
  let added = 0;
  const now = Date.now();
  store.setData((d) => {
    for (const r of rows) {
      if (d.leads.some((l) => l.company.toLowerCase() === r.company.toLowerCase())) continue;
      const lead: Lead = {
        id: uid(), company: r.company.slice(0, 80),
        contact: r.phone || r.email, email: r.email, url: r.url,
        location: r.city, note: r.note || "Zaimportowany lead.",
        status: "new", createdAt: now, updatedAt: now,
      };
      d.leads.unshift(lead);
      added++;
    }
  });
  return { added, total: rows.length };
}
