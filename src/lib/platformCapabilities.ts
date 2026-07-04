// === Warstwa możliwości kanałów + potwierdzenia (platformCapabilities) ===
// Każdy zielony sukces oznacza POTWIERDZONY skutek. Kanał raportuje uczciwy stan: unavailable /
// export_only / simulated / connected / degraded. Brak uprawnień → export-only, NIE fałszywy sukces.
// Po publikacji stan LIVE / PROCESSING / REJECTED — PROCESSING nigdy nie jest pokazywane jako LIVE.
// Reklamy płatne wymagają Ads API (nie zastąpi ich zwykły post). Wersję Meta Graph API trzymamy w
// konfiguracji (nie zakładamy, że v19.0 działa) i sprawdzamy health-checkiem. Sekrety wyłącznie po
// stronie backendu — tu operujemy tylko flagami zdolności. Czyste i testowalne. S9-safe.

export type ChannelState = "unavailable" | "export_only" | "simulated" | "connected" | "degraded";
export type PublishState = "LIVE" | "PROCESSING" | "REJECTED" | "UNKNOWN";

export interface ChannelCapabilityInput {
  channel: string;
  hasToken?: boolean;
  hasRequiredPermissions?: boolean;
  appApproved?: boolean;   // TikTok Direct Post / LinkedIn Posts API
  healthy?: boolean;       // health-check API
  supportsExport?: boolean; // można wyeksportować do ręcznego wklejenia
  supportsPaidAds?: boolean; // czy kanał ma dostęp do Ads API
}

export interface ChannelCapability {
  channel: string;
  state: ChannelState;
  reason: string;
  canPublishApi: boolean;  // realna publikacja przez API
  canPaidAds: boolean;     // reklamy płatne (osobne Ads API)
}

/**
 * Pure: rozstrzygnij zdolność kanału. Bez tokena → unavailable/export_only; token bez uprawnień →
 * export_only (nie udajemy sukcesu); pełne uprawnienia + zdrowe API → connected; niezdrowe → degraded.
 */
export function resolveChannelCapability(input: ChannelCapabilityInput): ChannelCapability {
  const base = { channel: input.channel, canPaidAds: !!input.supportsPaidAds };
  if (!input.hasToken) {
    return input.supportsExport
      ? { ...base, state: "export_only", reason: "Brak połączenia API — dostępny tylko eksport do ręcznego wklejenia.", canPublishApi: false }
      : { ...base, state: "unavailable", reason: "Kanał niedostępny (brak tokena/integracji).", canPublishApi: false };
  }
  if (!input.hasRequiredPermissions || input.appApproved === false) {
    return { ...base, state: "export_only", reason: "Brak wymaganych uprawnień/zatwierdzenia aplikacji — export-only zamiast fałszywej publikacji.", canPublishApi: false };
  }
  if (input.healthy === false) {
    return { ...base, state: "degraded", reason: "API zgłasza problemy (health-check) — publikacja wstrzymana.", canPublishApi: false };
  }
  return { ...base, state: "connected", reason: "Połączono z pełnymi uprawnieniami.", canPublishApi: true };
}

/** Pure: zinterpretuj surowy stan publikacji z API. PROCESSING NIE jest LIVE. */
export function interpretPublishState(apiState: string | null | undefined): PublishState {
  const s = (apiState || "").toString().toUpperCase();
  if (/\b(LIVE|PUBLISHED|ACTIVE|SUCCEEDED)\b/.test(s)) return "LIVE";
  if (/\b(PROCESSING|IN_PROGRESS|PENDING|SCHEDULED|REVIEW|PROCESSING_UPLOAD)\b/.test(s)) return "PROCESSING";
  if (/\b(REJECTED|FAILED|ERROR|DISAPPROVED|BLOCKED)\b/.test(s)) return "REJECTED";
  return "UNKNOWN";
}

/** Pure: TYLKO LIVE wolno pokazać jako potwierdzoną publikację. */
export function isConfirmedLive(state: PublishState): boolean {
  return state === "LIVE";
}

export interface PublishReceipt {
  channel: string;
  externalId: string;
  url?: string;
  state: PublishState;
  confirmedAt?: number; // ustawiane tylko dla LIVE
}

/** Pure: zbuduj receipt publikacji. confirmedAt ustawiamy WYŁĄCZNIE dla potwierdzonego LIVE. */
export function buildReceipt(input: { channel: string; externalId: string; url?: string; apiState?: string; now: number }): PublishReceipt {
  const state = interpretPublishState(input.apiState);
  return { channel: input.channel, externalId: input.externalId, url: input.url, state, confirmedAt: state === "LIVE" ? input.now : undefined };
}

// Wersja Meta Graph API w KONFIGURACJI (nie zakładamy, że jakakolwiek jest wieczna).
export const DEFAULT_META_GRAPH_VERSION = "v21.0";

/** Pure: rozstrzygnij wersję Meta Graph API z konfiguracji (z bezpiecznym domyślnym). */
export function resolveMetaGraphVersion(configured?: string | null): string {
  const v = (configured || "").trim();
  return /^v\d+\.\d+$/.test(v) ? v : DEFAULT_META_GRAPH_VERSION;
}

/** Pure: czy reklamę płatną wolno wykonać? Wymaga Ads API — zwykły post NIE zastępuje reklamy. */
export function canRunPaidAd(cap: ChannelCapability): { ok: boolean; reason: string } {
  if (!cap.canPaidAds) return { ok: false, reason: "Brak dostępu do Ads API — reklamy płatnej NIE zastąpi zwykły post." };
  if (cap.state !== "connected") return { ok: false, reason: `Kanał nie jest w pełni połączony (${cap.state}).` };
  return { ok: true, reason: "Ads API dostępne." };
}
