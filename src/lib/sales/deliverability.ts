// === Deliverability Guard — chroni reputację nadawcy i skuteczność wysyłki ===
// Sama walidacja formatu to za mało: maile do martwych/jednorazowych skrzynek odbijają się
// i lądują w spamie. Tu: wykrywanie adresów jednorazowych, weryfikacja MX (DNS-over-HTTPS,
// działa w przeglądarce), throttling, dzienne limity i czarna lista odbić/skarg. Rdzeń decyzji
// jest CZYSTY (wstrzykiwane dane) — łatwy w testach; cienkie nakładki czytają store/sieć.
import { store } from "../store";
import { fetchTimeout } from "../http";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Najczęstsze domeny adresów jednorazowych — do nich NIE wysyłamy (psują metryki i reputację).
const DISPOSABLE = new Set<string>([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "getnada.com", "throwawaymail.com", "sharklasers.com",
  "maildrop.cc", "dispostable.com", "fakeinbox.com", "mintemail.com", "mohmal.com",
  "tempmailo.com", "emailondeck.com", "spam4.me", "mailnesia.com", "tempr.email",
]);

export function emailFormatOk(email: string): boolean {
  return EMAIL_RE.test((email || "").trim());
}

export function domainOf(email: string): string {
  return (email || "").trim().toLowerCase().split("@")[1] || "";
}

export function isDisposableEmail(email: string): boolean {
  return DISPOSABLE.has(domainOf(email));
}

// --- Czarna lista (odbicia / skargi spam) — trwała w localStorage ---
const BL_KEY = "jarvis.mail.blacklist.v1";
function loadBlacklist(): Record<string, { reason: string; at: number }> {
  try { return JSON.parse(localStorage.getItem(BL_KEY) || "{}"); } catch { return {}; }
}
function saveBlacklist(m: Record<string, { reason: string; at: number }>) {
  try { localStorage.setItem(BL_KEY, JSON.stringify(m)); } catch { /* prywatny tryb */ }
}
export function isBlacklisted(email: string): boolean {
  return !!loadBlacklist()[(email || "").trim().toLowerCase()];
}
export function blacklistEmail(email: string, reason: "bounce" | "spam" | "unsub" | "manual", at = Date.now()): void {
  const e = (email || "").trim().toLowerCase();
  if (!e) return;
  const m = loadBlacklist();
  m[e] = { reason, at };
  saveBlacklist(m);
}

// --- Liczenie dzisiejszej wysyłki (z dziennika) — czyste, z wstrzykniętą listą ---
export function sentCountToday(sent: { at?: number }[], now = Date.now()): number {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const start = d.getTime();
  return (sent || []).filter((m) => (m.at ?? 0) >= start).length;
}

// --- Throttling: deterministyczne opóźnienie bazowe (jitter dokładamy przy wysyłce) ---
/** Pure: ile czekać przed kolejną wysyłką (ms) — rośnie z liczbą dziś wysłanych, do limitu. */
export function throttleBaseMs(sentToday: number): number {
  return Math.min(90_000, 20_000 + Math.max(0, sentToday) * 1_500);
}

export interface SendGateInput {
  email: string;
  sentToday: number;
  dailyLimit: number;   // 0 = bez limitu
  blacklisted: boolean;
  mxOk?: boolean;        // undefined = nie sprawdzano (nie blokuje)
}
export interface SendGate { allow: boolean; reason: string; delayMs: number }

/** Pure: czy wolno wysłać do tego adresu teraz + zalecane opóźnienie. */
export function sendGate(i: SendGateInput): SendGate {
  const email = (i.email || "").trim();
  if (!emailFormatOk(email)) return { allow: false, reason: "Zły format adresu e-mail.", delayMs: 0 };
  if (i.blacklisted) return { allow: false, reason: "Adres na czarnej liście (wcześniejsze odbicie/skarga).", delayMs: 0 };
  if (isDisposableEmail(email)) return { allow: false, reason: "Adres tymczasowy (jednorazowy) — pomijam.", delayMs: 0 };
  if (i.mxOk === false) return { allow: false, reason: "Domena nie przyjmuje poczty (brak rekordu MX).", delayMs: 0 };
  if (i.dailyLimit > 0 && i.sentToday >= i.dailyLimit) return { allow: false, reason: "Osiągnięto dzienny limit wysyłki — chronię reputację nadawcy.", delayMs: 0 };
  return { allow: true, reason: "OK", delayMs: throttleBaseMs(i.sentToday) };
}

// --- Weryfikacja MX przez DNS-over-HTTPS (Cloudflare 1.1.1.1) — best-effort, CORS-OK ---
const MX_CACHE = new Map<string, boolean>();
export async function checkMx(domain: string): Promise<boolean | undefined> {
  const d = (domain || "").trim().toLowerCase();
  if (!d) return false;
  if (MX_CACHE.has(d)) return MX_CACHE.get(d);
  try {
    const r = await fetchTimeout(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=MX`, { headers: { accept: "application/dns-json" } }, 6000);
    const j = await r.json().catch(() => null);
    // Status 0 = NOERROR; Answer z rekordami MX (type 15) = domena przyjmuje pocztę.
    const ok = !!j && j.Status === 0 && Array.isArray(j.Answer) && j.Answer.some((a: { type?: number }) => a.type === 15);
    MX_CACHE.set(d, ok);
    return ok;
  } catch {
    return undefined; // brak pewności → nie blokuj (best-effort)
  }
}

// --- Nakładka łącząca rdzeń z realnymi danymi (store + DoH) ---
export interface EvalOpts { checkMxLive?: boolean; now?: number }
export async function evaluateSend(email: string, opts: EvalOpts = {}): Promise<SendGate> {
  const s = store.settings;
  const sentToday = sentCountToday(store.data.sentMail || [], opts.now);
  const mxOk = opts.checkMxLive ? await checkMx(domainOf(email)) : undefined;
  return sendGate({
    email,
    sentToday,
    dailyLimit: Number(s.mailDailyLimit) || 0,
    blacklisted: isBlacklisted(email),
    mxOk,
  });
}
