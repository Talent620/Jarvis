// Lekka integracja z Google — BEZ klucza i BEZ logowania w aplikacji.
// Otwieramy gotowe, oficjalne adresy (Gmail compose / Kalendarz / Mapy) —
// użytkownik jest zalogowany w przeglądarce, więc działa od ręki.
// Pełny dostęp przez API (czytanie skrzynki itd.) to backend OAuth — src/lib/google.ts.

/**
 * Otwórz URL z niezaufanego źródła (np. strona leada z OSM) tylko gdy to http/https —
 * blokuje `javascript:`/`data:` i inne schematy. Pusty/niepoprawny URL → nic.
 */
export function safeOpenExternal(raw?: string): void {
  if (!raw) return;
  try {
    const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "https://x");
    if (u.protocol === "http:" || u.protocol === "https:") window.open(u.toString(), "_blank", "noopener,noreferrer");
  } catch {
    /* nieprawidłowy URL — pomiń */
  }
}

/** Gmail: okno nowej wiadomości z gotowym adresatem, tematem i treścią. */
export function gmailComposeUrl(to: string, subject: string, body: string): string {
  const p = new URLSearchParams({ view: "cm", fs: "1", to, su: subject, body });
  return `https://mail.google.com/mail/?${p}`;
}

/** Klasyczny mailto: (domyślny program pocztowy — Outlook/Thunderbird/telefon). */
export function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Google Kalendarz: szkic wydarzenia (tytuł, opis, opcjonalnie dzień YYYY-MM-DD). */
export function gcalEventUrl(title: string, details = "", dateISO?: string): string {
  const p = new URLSearchParams({ action: "TEMPLATE", text: title, details });
  if (dateISO) {
    const d = dateISO.slice(0, 10).replace(/-/g, "");
    // Wydarzenie całodniowe: koniec = dzień następny (wymóg formatu Google).
    const next = new Date(dateISO.slice(0, 10) + "T00:00:00");
    next.setDate(next.getDate() + 1);
    const e = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
    p.set("dates", `${d}/${e}`);
  }
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** SMS z gotową treścią — na telefonie otwiera Wiadomości (jeden klik = wysłane). */
export function smsUrl(phone: string, body: string): string {
  const p = phone.replace(/[\s-]/g, "");
  // Android: ?body= ; iOS: &body= — format z „?&" działa na obu.
  return `sms:${p}?&body=${encodeURIComponent(body)}`;
}

/** Google Maps: wyszukanie firmy (nazwa + adres/miasto) — opinie, zdjęcia, otoczenie. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * Usuwa placeholdery, które model bywa dopisuje na końcu maila (np. „[Twoje imię i nazwisko]",
 * „[Nazwa firmy]", „[Telefon]"). Bez tego do klienta szedł nieuzupełniony nawias, mimo że podpis
 * z prawdziwym nazwiskiem dokleja się osobno. W cold-mailu nawiasy kwadratowe to praktycznie zawsze
 * placeholder, więc bezpiecznie je czyścimy i sprzątamy puste linie. S9-safe (bez /u).
 */
export function stripPlaceholders(text: string): string {
  return (text || "")
    .replace(/\[[^\]\n]{1,60}\]/g, "") // [Twoje imię i nazwisko], [Nazwa firmy], [Telefon]…
    .replace(/[ \t]+\n/g, "\n") // spacje na końcu linii (po usunięciu nawiasu)
    .replace(/\n{3,}/g, "\n\n") // bez wielkich dziur
    .trim();
}

/** Dopisuje podpis (stopkę: telefon, strona) na końcu treści — bez dublowania, bez placeholderów. */
export function appendSignature(body: string, signature?: string): string {
  const sig = (signature || "").trim();
  const b = stripPlaceholders(body);
  if (!sig) return b;
  if (!b) return sig;
  if (b.includes(sig)) return b; // już dopisany (np. ręcznie) — nie dubluj
  return `${b}\n\n${sig}`;
}

/**
 * Wyciągnij temat i treść z szkicu oferty (pierwsza linia „Temat: …").
 * Jeśli podano `signature`, dopisuje ją automatycznie na końcu treści.
 */
export function splitOffer(offer: string, fallbackSubject: string, signature?: string): { subject: string; body: string } {
  // Zakotwicz do POCZĄTKU linii (m), żeby „Temat:" w środku treści nie ucinał maila;
  // \r?\n obsługuje CRLF (bez zostawiania osieroconego \r).
  const subject = /^\s*Temat:\s*(.+)/im.exec(offer)?.[1]?.trim() || fallbackSubject;
  const raw = offer.replace(/^\s*Temat:\s*.+\r?\n?/im, "").trim();
  return { subject, body: appendSignature(raw, signature) };
}
