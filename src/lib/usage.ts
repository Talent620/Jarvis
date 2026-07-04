// === Adaptive UI: śledzenie użycia sekcji (lokalnie, max 30 dni) ===
// Każde otwarcie sekcji zapisuje zdarzenie {id, t}. Po zebraniu tygodnia danych
// menu układa się według częstości użycia w BIEŻĄCEJ porze dnia (rano/dzień/
// wieczór) — produkt uczy się użytkownika, nie odwrotnie. Wszystko offline.

// UWAGA: klucz MUSI być inny niż telemetria kosztów (`usageTelemetry.ts` → "jarvis.usage.v1").
// Wcześniej oba moduły dzieliły ten sam klucz z niekompatybilnymi schematami ({id,t} vs
// {at,provider,model,...}) → wzajemna korupcja danych i `resetAdaptive()` kasujące koszty.
const KEY = "jarvis.uiusage.v1";
const ORDER_KEY = "jarvis.usage.order.v1";
const TOASTED_KEY = "jarvis.usage.toasted.v1";
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_EVENTS = 4000;
const RESORT_MS = 7 * 24 * 3600 * 1000;

export type Bucket = "morning" | "day" | "evening";

export interface UsageEvent {
  id: string;
  t: number;
}

function load(): UsageEvent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    // Filtr kształtu: odporność na dane zapisane pod starym, współdzielonym kluczem
    // (wpisy telemetrii kosztów nie mają `id`+numerycznego `t`).
    return raw.filter((e): e is UsageEvent => !!e && typeof e.id === "string" && typeof e.t === "number");
  } catch {
    return [];
  }
}

function save(events: UsageEvent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    /* quota — trudno, statystyki są best-effort */
  }
}

/** Pora dnia dla zdarzenia: rano 5–12, dzień 12–18, wieczór 18–5. */
export function bucketOf(date: Date): Bucket {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "day";
  return "evening";
}

/** Zanotuj użycie sekcji (np. otwarcie pozycji menu). */
export function track(id: string, now = Date.now()): void {
  const cutoff = now - MAX_AGE_MS;
  const events = load().filter((e) => e.t >= cutoff);
  events.push({ id, t: now });
  save(events.slice(-MAX_EVENTS));
}

/** Czy mamy co najmniej tydzień danych (pierwsze zdarzenie ≥ 7 dni temu)? */
export function hasWeekOfData(now = Date.now()): boolean {
  const events = load();
  return events.length >= 10 && now - events[0].t >= 7 * 24 * 3600 * 1000;
}

/**
 * Ułóż identyfikatory wg średniej częstości użycia w danej porze dnia.
 * Stabilnie: nieużywane sekcje zachowują oryginalną kolejność na końcu.
 */
export function orderForBucket(ids: string[], bucket: Bucket, now = Date.now()): string[] {
  const cutoff = now - MAX_AGE_MS;
  const counts = new Map<string, number>();
  for (const e of load()) {
    if (e.t < cutoff) continue;
    if (bucketOf(new Date(e.t)) !== bucket) continue;
    counts.set(e.id, (counts.get(e.id) || 0) + 1);
  }
  return ids
    .map((id, i) => ({ id, i, n: counts.get(id) || 0 }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.id);
}

/**
 * Adaptacyjna kolejność menu: liczona raz i trzymana 7 dni (żeby układ nie
 * skakał), potem cicho przeliczana. Zwraca null, gdy danych za mało.
 */
export function adaptiveOrder(ids: string[], now = Date.now()): string[] | null {
  if (!hasWeekOfData(now)) return null;
  const bucket = bucketOf(new Date(now));
  try {
    const cached = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
    if (cached?.bucket === bucket && cached?.at && now - cached.at < RESORT_MS && Array.isArray(cached.order)) {
      // Dolicz ewentualne nowe sekcje, których nie było przy sortowaniu.
      const known = new Set(cached.order as string[]);
      return [...(cached.order as string[]).filter((id) => ids.includes(id)), ...ids.filter((id) => !known.has(id))];
    }
  } catch {
    /* przelicz od zera */
  }
  const order = orderForBucket(ids, bucket, now);
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify({ bucket, at: now, order }));
  } catch {
    /* ignore */
  }
  return order;
}

/** Czy to pierwsza reorganizacja (pokazujemy jednorazowy toast z „Cofnij")? */
export function shouldAnnounceAdapt(): boolean {
  try {
    if (localStorage.getItem(TOASTED_KEY)) return false;
    localStorage.setItem(TOASTED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** Wyzeruj adaptację (przy „Resetuj do domyślnego"). */
export function resetAdaptive(): void {
  try {
    localStorage.removeItem(ORDER_KEY);
    localStorage.removeItem(KEY);
    localStorage.removeItem(TOASTED_KEY);
  } catch {
    /* ignore */
  }
}

/** Słupki aktywności: liczba zdarzeń per godzina (0–23) z ostatnich 7 dni. */
export function hourlyActivity(now = Date.now()): number[] {
  const cutoff = now - 7 * 24 * 3600 * 1000;
  const hours = new Array(24).fill(0);
  for (const e of load()) {
    if (e.t >= cutoff) hours[new Date(e.t).getHours()]++;
  }
  return hours;
}
