// Eksport korpusu treningowego LoRA „Twój głos" z REALNYCH ofert użytkownika.
// Buduje pary instrukcja→odpowiedź w formacie z server/lora/data/example.jsonl,
// ANONIMIZUJĄC PII (nazwa klienta, miasto, e-mail, telefon, www). Model uczy się
// STYLU, nie danych klientów. Czyste i browser-safe — trening robi serwer z GPU.
import type { Lead } from "../types";

export interface TrainingExample {
  instruction: string;
  input: string;
  output: string;
}

const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const RE_URL = /https?:\/\/\S+|\bwww\.[a-z0-9-]+\.[a-z]{2,}\b|\b[a-z0-9-]+\.(?:pl|com|net|eu|org|info|biz|shop)\b/gi;
// Telefon PL: 9+ cyfr z opcjonalnym prefiksem/separatorami (po e-mailach/URL-ach, by ich nie ruszać).
const RE_PHONE = /\+?\d(?:[\s-]?\d){8,}/g;

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Zamień wystąpienia nazwy (≥3 znaki) na token, bez względu na wielkość liter.
 * Dla nazw jednowyrazowych dokłada dopasowanie po RDZENIU (`\bKrak\w*`), by złapać polską
 * odmianę („Kraków" → „Krakowie"). Anonimizacja PII woli nad-zamaskować niż przepuścić dane.
 */
function replaceName(text: string, name: string | undefined, token: string): string {
  const n = (name || "").trim();
  if (n.length < 3) return text;
  let out = text.replace(new RegExp(esc(n), "gi"), token); // dokładne wystąpienie
  if (!/\s/.test(n) && n.length >= 5) {
    const stem = n.slice(0, Math.max(4, n.length - 3)); // rdzeń bez końcówki fleksyjnej
    out = out.replace(new RegExp(`\\b${esc(stem)}\\w*`, "gi"), token);
  }
  return out;
}

/** Usuń PII z tekstu oferty/kontekstu: nazwa klienta, miasto, e-mail, www, telefon. Czysta. */
export function anonymize(text: string, lead?: { company?: string; location?: string }): string {
  let t = String(text || "");
  t = replaceName(t, lead?.company, "<KLIENT>");
  t = replaceName(t, lead?.location, "<MIASTO>");
  t = t.replace(RE_EMAIL, "<EMAIL>").replace(RE_URL, "<WWW>").replace(RE_PHONE, "<TELEFON>");
  return t;
}

/** Zbuduj korpus instrukcja→odpowiedź z leadów, które mają ofertę/cold-mail. Czysta. */
export function buildLoraCorpus(leads: Lead[]): TrainingExample[] {
  const out: TrainingExample[] = [];
  for (const l of leads || []) {
    const body = String(l.offer || l.intel?.email || "").trim();
    if (!body) continue; // tylko leady z gotową ofertą/mailem
    const niche = l.niche?.trim();
    const instruction = niche
      ? `Napisz krótki cold-mail oferty do firmy z branży: ${niche}.`
      : "Napisz krótki cold-mail oferty do lokalnej firmy.";
    const ctx: string[] = [];
    if (l.note) ctx.push(l.note);
    if (!l.url) ctx.push("brak strony www");
    const input = anonymize(ctx.join("; ") || "Lead <KLIENT>.", l);
    const output = anonymize(body, l);
    out.push({ instruction, input, output });
  }
  return out;
}

/** Serializacja do JSONL (jedna linia = jeden przykład). Czysta. */
export function corpusToJsonl(examples: TrainingExample[]): string {
  if (!examples.length) return "";
  return examples.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
