// === Import konwersji offline — osobny, ZATWIERDZANY connector (conversionUpload) ===
// Domyka pętlę ROI: wygrane/wpłaty można zaimportować z powrotem do platformy (np. Google Ads
// offline conversions), ale to OSOBNY krok wymagający JAWNEGO zatwierdzenia. Bez identyfikatora
// kliknięcia (gclid) NIE tworzymy fałszywej konwersji. Dane osobowe (e-mail/telefon) normalizujemy
// i HASZUJEMY wyłącznie za zgodą i tylko przez wstrzyknięty hasher (bez zgody/hashera — pomijamy).
// Nic nie jest „wysłane/uploaded" bez potwierdzenia. Płatne API mockowane w testach. S9-safe.

export interface RoiConversion {
  gclid?: string;             // identyfikator kliknięcia z reklamy (wymagany do atrybucji)
  conversionAction: string;   // nazwa/id akcji konwersji na platformie
  conversionDateTime: string; // ISO
  value: number;
  currency: string;
  email?: string;             // PII — użyte TYLKO za zgodą (enhanced conversions)
  phone?: string;
}

export type ConversionStatus = "ready" | "skipped_no_id";

export interface ConversionUpload {
  status: ConversionStatus;   // ready = ma gclid; skipped_no_id = brak id (bez fałszywej atrybucji)
  gclid?: string;
  conversionAction: string;
  conversionDateTime: string;
  conversionValue: number;
  currencyCode: string;
  userIdentifiers?: { hashedEmail?: string; hashedPhone?: string }; // tylko za zgodą + hasher
}

const normEmail = (e: string): string => e.trim().toLowerCase();
const normPhone = (p: string): string => {
  const digits = p.replace(/[^0-9+]/g, "");
  return digits.startsWith("+") ? digits : digits ? `+${digits}` : "";
};

/**
 * Pure: przygotuj konwersje do importu. Brak gclid → status skipped_no_id (nie zmyślamy atrybucji).
 * PII dołączamy WYŁĄCZNIE, gdy jest zgoda I podano hasher (inaczej pomijamy — prywatność domyślnie).
 */
export function prepareConversions(convs: RoiConversion[], opts: { consentPII?: boolean; hasher?: (s: string) => string }): ConversionUpload[] {
  const canPII = !!opts.consentPII && typeof opts.hasher === "function";
  return (convs || []).map((c) => {
    const base: ConversionUpload = {
      status: c.gclid ? "ready" : "skipped_no_id",
      gclid: c.gclid,
      conversionAction: c.conversionAction,
      conversionDateTime: c.conversionDateTime,
      conversionValue: Math.max(0, Number(c.value) || 0),
      currencyCode: c.currency || "PLN",
    };
    if (canPII) {
      const ids: { hashedEmail?: string; hashedPhone?: string } = {};
      if (c.email) ids.hashedEmail = opts.hasher!(normEmail(c.email));
      const ph = c.phone ? normPhone(c.phone) : "";
      if (ph) ids.hashedPhone = opts.hasher!(ph);
      if (ids.hashedEmail || ids.hashedPhone) base.userIdentifiers = ids;
    }
    return base;
  });
}

export type UploadState = "prepared" | "uploaded_confirmed" | "failed";

export interface UploadResult {
  state: UploadState;
  count: number;      // ile realnie dotyczy (ready)
  skipped: number;    // pominięte bez id
  message: string;
}

export type UploadFn = (uploads: ConversionUpload[]) => Promise<{ ok: boolean; error?: string }>;

/**
 * Wyślij konwersje TYLKO po jawnym zatwierdzeniu. Bez zgody → status „prepared" (nic nie wysłano).
 * Bez uploadFn (np. headless) → też „prepared" (nie potwierdzimy). Sukces (uploaded_confirmed) tylko
 * po potwierdzeniu z platformy. NIGDY nie zwraca uploaded_confirmed bez approved.
 */
export async function uploadConversions(uploads: ConversionUpload[], opts: { approved: boolean; uploadFn?: UploadFn }): Promise<UploadResult> {
  const ready = (uploads || []).filter((u) => u.status === "ready");
  const skipped = (uploads || []).length - ready.length;

  if (!opts.approved) return { state: "prepared", count: ready.length, skipped, message: "Przygotowano do importu — czeka na Twoje zatwierdzenie. Nic nie wysłano." };
  if (!ready.length) return { state: "prepared", count: 0, skipped, message: "Brak konwersji z identyfikatorem kliknięcia — nie ma czego zaimportować." };
  if (!opts.uploadFn) return { state: "prepared", count: ready.length, skipped, message: "Zatwierdzone, ale brak połączenia z platformą — przygotowane do wysyłki." };

  try {
    const r = await opts.uploadFn(ready);
    return r.ok
      ? { state: "uploaded_confirmed", count: ready.length, skipped, message: `Zaimportowano ${ready.length} konwersji (potwierdzone).` }
      : { state: "failed", count: 0, skipped, message: `Import nie powiódł się: ${r.error || "błąd platformy"}.` };
  } catch (e) {
    return { state: "failed", count: 0, skipped, message: `Import nie powiódł się: ${e instanceof Error ? e.message : "błąd"}.` };
  }
}
