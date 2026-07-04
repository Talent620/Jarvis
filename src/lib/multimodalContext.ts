// === Multimodalne rozumienie biznesowe (kontrolowane) ===
// Gemini widzi obraz, ale JARVIS NIE tworzy zmyślonych danych księgowych: najpierw structured
// extraction, potem WALIDACJA, dopiero później PROPOZYCJA zapisu (nic nie zapisuje się automatycznie
// bez potwierdzenia). Czyste i testowalne. S9-safe (jawne klasy PL, bez /u/\p/lookbehind).

import { isValidEmail } from "./mailer";

export type VisualKind = "invoice" | "card" | "screenshot" | "document" | "general";

/** Pure: po intencji użytkownika rozpoznaj, co pokazuje (faktura/wizytówka/screen/dokument). */
export function classifyVisualIntent(text: string): VisualKind {
  const t = (text || "").toLowerCase();
  if (/faktur|rachunek|paragon|do zapłaty|kwota|nip\b/.test(t)) return "invoice";
  if (/wizytówk|wizytowk|kontakt|przedstawiciel|namiary/.test(t)) return "card";
  if (/screen|zrzut|strona|witryn|audyt|www/.test(t)) return "screenshot";
  if (/dokument|umowa|pismo|pdf|streść|stresc|podsumuj/.test(t)) return "document";
  return "general";
}

const num = (x: unknown): number | undefined => {
  const n = typeof x === "string" ? Number(x.replace(/[^0-9.,-]/g, "").replace(",", ".")) : Number(x);
  return Number.isFinite(n) ? n : undefined;
};
const str = (x: unknown): string | undefined => {
  const s = (typeof x === "string" ? x : "").trim();
  return s || undefined;
};

export interface InvoiceDraft {
  amount?: number;
  client?: string;
  nip?: string;
  invoiceNo?: string;
  warnings: string[];
  valid: boolean; // czy nadaje się na propozycję (po walidacji)
}

/**
 * Pure: zwaliduj odczyt faktury. Odrzuca zmyślone/niepoprawne dane księgowe:
 * kwota musi być skończona i nieujemna; brak kwoty/klienta → ostrzeżenie i valid=false.
 */
export function validateInvoiceExtraction(data: Record<string, unknown> | null): InvoiceDraft {
  const warnings: string[] = [];
  const amount = num(data?.amount ?? data?.total ?? data?.kwota);
  const client = str(data?.client ?? data?.seller ?? data?.sprzedawca ?? data?.nabywca);
  const nip = str(data?.nip)?.replace(/[^0-9]/g, "");
  const invoiceNo = str(data?.invoiceNo ?? data?.number ?? data?.numer);

  if (amount === undefined) warnings.push("Nie odczytałem pewnej kwoty — sprawdź sam.");
  else if (amount < 0) warnings.push("Kwota ujemna — pomijam jako błędną.");
  if (!client) warnings.push("Brak czytelnej nazwy kontrahenta.");
  if (nip && nip.length !== 10) warnings.push("NIP nie ma 10 cyfr — może być błędny.");

  const valid = amount !== undefined && amount >= 0 && !!client;
  return { amount: amount !== undefined && amount >= 0 ? amount : undefined, client, nip, invoiceNo, warnings, valid };
}

export interface CardDraft {
  company?: string;
  person?: string;
  email?: string;
  phone?: string;
  warnings: string[];
  valid: boolean;
}

/** Pure: zwaliduj odczyt wizytówki → propozycja leada/kontaktu. E-mail przez wspólny walidator. */
export function validateCardExtraction(data: Record<string, unknown> | null): CardDraft {
  const warnings: string[] = [];
  const company = str(data?.company ?? data?.firma);
  const person = str(data?.name ?? data?.person ?? data?.imię ?? data?.imie);
  let email = str(data?.email);
  const phone = str(data?.phone ?? data?.telefon)?.replace(/[^0-9+]/g, "");

  if (email && !isValidEmail(email)) { warnings.push("Odczytany e-mail wygląda niepoprawnie — pomijam."); email = undefined; }
  if (!company && !person) warnings.push("Brak nazwy firmy i osoby — mało danych na lead.");
  if (phone && phone.replace(/\D/g, "").length < 7) warnings.push("Numer telefonu wygląda na niekompletny.");

  const valid = !!(company || person) && (!!email || !!phone);
  return { company, person, email, phone, warnings, valid };
}

/** Pure: krótka, UCZCIWA propozycja do potwierdzenia (nic nie zapisujemy automatycznie). */
export function proposalText(kind: VisualKind, draft: InvoiceDraft | CardDraft): string {
  if (kind === "invoice") {
    const d = draft as InvoiceDraft;
    if (!d.valid) return `Odczyt faktury niepewny — ${d.warnings.join(" ") || "za mało danych"}. Nic nie zapisuję; popraw ręcznie.`;
    return `Faktura (DRAFT, do potwierdzenia): ${d.client}${d.amount != null ? ` — ${d.amount} zł` : ""}${d.invoiceNo ? ` (nr ${d.invoiceNo})` : ""}. Zapisać jako projekt finansowy?`;
  }
  if (kind === "card") {
    const d = draft as CardDraft;
    if (!d.valid) return `Wizytówka niepewna — ${d.warnings.join(" ") || "za mało danych"}. Nic nie zapisuję.`;
    return `Lead (DRAFT, do potwierdzenia): ${d.company || d.person}${d.email ? ` · ${d.email}` : ""}${d.phone ? ` · ${d.phone}` : ""}. Dodać do Pulpitu Sprzedaży?`;
  }
  return "Gotowe — podsumowanie powyżej. Co z tym zrobić?";
}
