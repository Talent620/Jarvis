// Lekka integracja z Google — BEZ klucza i BEZ logowania w aplikacji.
// Otwieramy gotowe, oficjalne adresy (Gmail compose / Kalendarz / Mapy) —
// użytkownik jest zalogowany w przeglądarce, więc działa od ręki.
// Pełny dostęp przez API (czytanie skrzynki itd.) to backend OAuth — src/lib/google.ts.

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

/** Google Maps: wyszukanie firmy (nazwa + adres/miasto) — opinie, zdjęcia, otoczenie. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Wyciągnij temat i treść z szkicu oferty (pierwsza linia „Temat: …"). */
export function splitOffer(offer: string, fallbackSubject: string): { subject: string; body: string } {
  const subject = /Temat:\s*(.+)/i.exec(offer)?.[1]?.trim() || fallbackSubject;
  const body = offer.replace(/Temat:\s*.+\n?/i, "").trim();
  return { subject, body };
}
