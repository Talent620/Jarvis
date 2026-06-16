import { fetchTimeout } from "./http";
import { resolveProvider, askModel } from "./brain";
import { store } from "./store";
import type { Lead, LeadIntel, SiteAudit } from "../types";

// === Teczka klienta (wywiad sprzedażowy) ===
// Trzy warstwy, jedna akcja:
//  1) AUDYT TECHNICZNY strony (bez AI, za darmo): HTTPS, wersja mobilna, SEO,
//     dane kontaktowe, sociale — twarde fakty, którymi otwierasz rozmowę.
//  2) SCORING 0–100: które leady są „gorące" (brak strony + telefon = dzwoń!).
//  3) ANALIZA AI: słabe punkty → co firma traci → rozwiązanie, które sprzedajesz
//     + spersonalizowany e-mail + skrypt rozmowy telefonicznej. Jedno wywołanie
//     modelu — spójna narracja we wszystkich materiałach.

// --- 1. Audyt techniczny strony (czyste parsowanie HTML — testowalne) ---

/** Wyciągnij sygnały jakości z surowego HTML (czysta funkcja). */
export function parseSiteHtml(html: string, url: string): SiteAudit {
  const h = html.slice(0, 400_000); // wystarczy początek; nie mielimy megabajtów
  const title = /<title[^>]*>([^<]{0,200})/i.exec(h)?.[1]?.trim();
  const socials: string[] = [];
  for (const s of ["facebook", "instagram", "tiktok", "linkedin", "youtube"]) {
    if (new RegExp(`${s}\\.com/`, "i").test(h)) socials.push(s);
  }
  return {
    ok: true,
    https: url.startsWith("https://"),
    viewport: /<meta[^>]+name=["']viewport/i.test(h),
    title,
    metaDesc: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(h),
    h1: /<h1[\s>]/i.test(h),
    og: /<meta[^>]+property=["']og:/i.test(h),
    contact: /(tel:|mailto:|\+?\d{2,3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{2,3})/.test(h),
    socials,
    bytes: html.length,
  };
}

/** Pobierz i zaudytuj stronę leada. Na telefonie CORS może blokować — wtedy
 *  audyt wraca z `ok:false` i analiza opiera się na danych z mapy. */
export async function auditSite(rawUrl: string): Promise<SiteAudit> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const res = await fetchTimeout(url, { redirect: "follow" }, 12000);
    if (!res.ok) return { ok: false, https: url.startsWith("https://"), error: `Strona odpowiada błędem ${res.status}.` };
    const html = await res.text();
    return parseSiteHtml(html, res.url || url);
  } catch {
    return { ok: false, error: "Nie udało się pobrać strony (blokada/offline) — analiza na danych z mapy." };
  }
}

/** Audyt → lista słabych punktów po polsku (twarde fakty do rozmowy). */
export function auditWeakPoints(a: SiteAudit | undefined, hasWebsite: boolean): string[] {
  const out: string[] = [];
  if (!hasWebsite) {
    out.push("BRAK STRONY WWW — firma jest niewidoczna w Google; klienci trafiają do konkurencji, która stronę ma.");
    return out;
  }
  if (!a || !a.ok) return a?.error ? [`Strona istnieje, ale: ${a.error}`] : [];
  if (!a.https) out.push("Brak HTTPS (kłódki) — przeglądarka straszy ostrzeżeniem o niezabezpieczonej stronie, Google obniża pozycję.");
  if (!a.viewport) out.push("Brak wersji mobilnej — ponad 60% klientów wchodzi z telefonu i widzi rozjechaną stronę.");
  if (!a.title || a.title.length < 10) out.push("Brak sensownego tytułu strony — w Google wyświetla się goły adres zamiast oferty.");
  if (!a.metaDesc) out.push("Brak opisu meta — Google pokazuje losowy tekst zamiast zachęty do kliknięcia.");
  if (!a.h1) out.push("Brak nagłówka H1 — słaba struktura SEO, gorsza pozycja w wyszukiwarce.");
  if (!a.og) out.push("Brak tagów Open Graph — link udostępniony na Facebooku/Messengerze wygląda pusto.");
  if (!a.contact) out.push("Brak widocznego telefonu/e-maila na stronie — klient nie wie, jak się skontaktować.");
  if (!a.socials?.length) out.push("Brak linków do social mediów — zero dowodu społecznego.");
  if ((a.bytes || 0) > 2_500_000) out.push("Bardzo ciężka strona — wolno się ładuje, klienci uciekają przed wczytaniem.");
  return out;
}

// --- 2. Scoring 0–100 (czysta heurystyka — testowalna) ---

/** Im wyżej, tym cieplejszy lead. Brak strony + telefon = dzwoń natychmiast. */
export function scoreLead(lead: Pick<Lead, "url" | "contact" | "email">, audit?: SiteAudit): number {
  let s = 30;
  const hasSite = !!lead.url;
  const phone = !!lead.contact && !lead.contact.includes("@");
  if (!hasSite) s += 45; // największy ból = największa szansa
  if (phone) s += 15; // jest do kogo zadzwonić
  if (lead.email || lead.contact?.includes("@")) s += 5;
  if (hasSite && audit?.ok) {
    const weak = auditWeakPoints(audit, true).length;
    s += Math.min(30, weak * 6); // im gorsza strona, tym łatwiej sprzedać poprawę
  }
  if (hasSite && audit && !audit.ok) s += 10; // strona padnięta/nieosiągalna — też argument
  return Math.max(0, Math.min(100, s));
}

export function scoreLabel(score: number): { emoji: string; label: string } {
  if (score >= 75) return { emoji: "🔥", label: "gorący" };
  if (score >= 50) return { emoji: "🌤", label: "dobry" };
  return { emoji: "❄", label: "chłodny" };
}

// --- 3. Analiza AI (jedno wywołanie → analiza + e-mail + skrypt) ---

const SYSTEM = [
  "Jesteś doradcą sprzedażowym światowej klasy w agencji stron internetowych (rynek polski).",
  "Dostajesz dane lokalnej firmy + wyniki technicznego audytu jej strony. Przygotuj komplet materiałów, by handlowiec był W PEŁNI gotowy do kontaktu.",
  "ZASADY: tylko fakty z danych — nie zmyślaj. Konkretnie, po polsku, językiem korzyści (co firma TRACI i co ZYSKA). Zero lania wody.",
  "ODPOWIEDZ DOKŁADNIE w tym formacie (zachowaj znaczniki sekcji):",
  "=== ANALIZA ===",
  "Słabe punkty (max 5), każdy w 1–2 zdaniach: problem → co przez to tracą → rozwiązanie, które oferujesz. Na końcu 1 zdanie: od czego zacząć rozmowę.",
  "=== EMAIL ===",
  "Pierwsza linia: „Temat: …”. Potem treść maks 110 słów: zaczep od KONKRETNEGO znalezionego problemu → wartość → dowód (mogę pokazać demo) → jedno pytanie-CTA. Uprzejmie, po ludzku, bez nachalności.",
  "=== ROZMOWA ===",
  "Skrypt telefoniczny: otwarcie (10 sekund, od znalezionego problemu), 2 pytania otwierające, odpowiedzi na 2 najczęstsze obiekcje („mam już stronę” / „nie mam budżetu”), domknięcie (propozycja demo).",
].join("\n");

/** Rozbij odpowiedź modelu na sekcje (czysta — testowalna). */
export function splitSections(text: string): { analysis: string; email: string; callScript: string } {
  const grab = (name: string) => {
    const re = new RegExp(`===\\s*${name}\\s*===\\s*([\\s\\S]*?)(?====\\s*[A-ZĄĆĘŁŃÓŚŹŻ]+\\s*===|$)`, "i");
    return re.exec(text)?.[1]?.trim() || "";
  };
  const analysis = grab("ANALIZA");
  const email = grab("EMAIL");
  const callScript = grab("ROZMOWA");
  // Model nie trzymał formatu → cała odpowiedź jako analiza (nic nie ginie).
  if (!analysis && !email && !callScript) return { analysis: text.trim(), email: "", callScript: "" };
  return { analysis, email, callScript };
}

function leadContext(lead: Lead, audit?: SiteAudit): string {
  const weak = auditWeakPoints(audit, !!lead.url);
  return [
    `Firma: ${lead.company}`,
    `Branża: ${lead.niche || "lokalna firma"}`,
    `Lokalizacja: ${[lead.address, lead.location].filter(Boolean).join(", ") || "—"}`,
    `Telefon: ${lead.contact && !lead.contact.includes("@") ? lead.contact : "—"}`,
    `E-mail: ${lead.email || (lead.contact?.includes("@") ? lead.contact : "—")}`,
    `Strona www: ${lead.url || "BRAK"}`,
    audit?.title ? `Tytuł strony: ${audit.title}` : "",
    `Godziny otwarcia: ${lead.hours || "—"}`,
    `Notatka: ${lead.note || "—"}`,
    "",
    "WYNIKI AUDYTU TECHNICZNEGO:",
    weak.length ? weak.map((w) => `- ${w}`).join("\n") : "- Strona w dobrym stanie technicznym (sprzedawaj rozbudowę: sklep, rezerwacje, pozycjonowanie).",
  ].filter(Boolean).join("\n");
}

/**
 * Pełna teczka klienta: audyt strony → scoring → analiza AI (słabe punkty,
 * e-mail, skrypt rozmowy). Wynik zapisuje się w leadzie (lead.intel).
 */
export async function buildDossier(leadId: string): Promise<LeadIntel | { error: string }> {
  const lead = store.data.leads.find((l) => l.id === leadId);
  if (!lead) return { error: "Nie znalazłem tego leada." };

  const audit = lead.url ? await auditSite(lead.url) : undefined;
  const score = scoreLead(lead, audit);

  const r = resolveProvider();
  if (!r || !r.apiKey?.trim()) {
    // Bez klucza AI: zapisz audyt + scoring (to też realna wartość) i powiedz wprost.
    const intel: LeadIntel = { score, audit, updatedAt: Date.now() };
    saveIntel(leadId, intel);
    return { error: "Audyt i scoring gotowe, ale do analizy AI potrzebny klucz (⚙ → AI)." };
  }

  try {
    const text = await askModel({ system: SYSTEM, history: [{ role: "user", content: `Przygotuj teczkę klienta:\n\n${leadContext(lead, audit)}` }], heavy: true });
    const { analysis, email, callScript } = splitSections(text);
    const intel: LeadIntel = { score, audit, analysis, email, callScript, updatedAt: Date.now() };
    saveIntel(leadId, intel);
    return intel;
  } catch (e) {
    const intel: LeadIntel = { score, audit, updatedAt: Date.now() };
    saveIntel(leadId, intel);
    return { error: `Audyt gotowy, ale AI nie odpowiedziało: ${e instanceof Error ? e.message : e}` };
  }
}

function saveIntel(leadId: string, intel: LeadIntel): void {
  store.setData((d) => {
    const l = d.leads.find((x) => x.id === leadId);
    if (l) {
      l.intel = intel;
      l.updatedAt = Date.now();
      // E-mail z teczki staje się ofertą leada (spójność ze starym przyciskiem Wyślij).
      if (intel.email) l.offer = intel.email;
    }
  });
}

/** Krótki SMS pod tego leada (czysta funkcja) — zaczep od najmocniejszego braku. */
export function smsDraft(lead: Pick<Lead, "company" | "url" | "location">, audit?: SiteAudit): string {
  const who = store.settings.userName && store.settings.userName !== "Sir" ? `, ${store.settings.userName}` : "";
  const hook = !lead.url
    ? `zauważyłem, że ${lead.company} nie ma strony www — klienci szukający w Google trafiają do konkurencji`
    : audit && !audit.viewport
      ? `strona ${lead.company} źle wyświetla się na telefonach, a większość klientów wchodzi z komórki`
      : `widzę, że stronę ${lead.company} da się mocno ulepszyć (Google, telefony)`;
  return `Dzień dobry! Piszę, bo ${hook}. Robię nowoczesne strony dla firm${lead.location ? ` z ${lead.location}` : " lokalnych"} i mam gotowe darmowe demo do pokazania. Mogę podesłać link? Pozdrawiam${who}`;
}

/** Przygotuj teczki dla wielu leadów po kolei (np. wszystkich nowych). */
export async function buildDossiers(leadIds: string[], onProgress?: (done: number, total: number) => void): Promise<number> {
  let ok = 0;
  for (let i = 0; i < leadIds.length; i++) {
    const r = await buildDossier(leadIds[i]);
    if (!("error" in r)) ok++;
    onProgress?.(i + 1, leadIds.length);
  }
  return ok;
}
