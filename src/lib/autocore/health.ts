// === AUTOCORE · Zdrowie dostawców/kluczy/modeli (trwałe, z klasyfikacją HTTP) ===
// Uzupełnia istniejący bezpiecznik sesji (resilience.CircuitBreaker w brain.ts) i cooldown kluczy
// (keys.ts) o pamięć TRWAŁĄ i semantykę błędów:
//   401/403 → klucz wyłączony do czasu ZMIANY klucza (śledzone po odcisku, nie po treści klucza),
//   402     → klucz bez środków: 24 h,
//   429     → Retry-After (gdy jest) albo backoff wykładniczy per klucz,
//   404 model / „model not found" → model oznaczony jako usunięty na 24 h,
//   400 „image/vision not supported" → model bez danej możliwości na 7 dni,
//   5xx/timeout → backoff dostawcy po serii (3+) błędów.
// Nigdy nie przechowuje kluczy — tylko 32-bitowy odcisk FNV-1a (nieodwracalny w praktyce).
import { loadJson, saveJson } from "../lsJson";
import type { ProviderId } from "../providers/types";

export type FailureKind =
  | "auth" | "payment" | "rate" | "server" | "timeout" | "network" | "model_missing" | "capability" | "bad_request" | "unknown";

export interface ClassifiedFailure { kind: FailureKind; status?: number; retryAfterSec?: number }

const FOREVER = Number.MAX_SAFE_INTEGER;
const H = 3600_000;
const STORE_KEY = "jarvis.autocore.health.v1";

interface KeyEntry { kind: "auth" | "payment" | "rate"; until: number; hits: number; at: number }
interface ModelEntry { kind: "model_missing" | "capability"; until: number; cap?: string; at: number }
interface ProviderEntry { fails: number; until: number; ok: number; ko: number; lastKind?: FailureKind; lastOkAt?: number; latencyEwma?: number }
interface HealthState { keys: Record<string, KeyEntry>; models: Record<string, ModelEntry>; providers: Record<string, ProviderEntry> }

let state: HealthState | null = null;
const S = (): HealthState => (state ??= loadJson<HealthState>(STORE_KEY, { keys: {}, models: {}, providers: {} }));
const persist = () => saveJson(STORE_KEY, S());

/** Odcisk klucza (FNV-1a 32-bit, hex) — identyfikuje „ten sam klucz" bez przechowywania sekretu. */
export function keyFingerprint(key: string): string {
  let h = 0x811c9dc5;
  const k = key || "";
  for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? ""));

/** Kod HTTP z błędu: pole `status` (adaptery AutoCore) albo „(NNN)" na końcu komunikatu adaptera. */
export function statusOf(e: unknown): number | undefined {
  const st = (e as { status?: unknown })?.status;
  if (typeof st === "number" && st >= 100 && st < 600) return st;
  const m = errMsg(e).match(/\((\d{3})\)\s*$/) || errMsg(e).match(/\b(40[0-9]|429|5\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

/** Retry-After w sekundach (liczba lub data HTTP); undefined, gdy brak/niepoprawny. */
export function retryAfterOf(e: unknown, now = Date.now()): number | undefined {
  const raw = (e as { retryAfter?: unknown })?.retryAfter;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 24 * 3600);
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? Math.max(0, Math.min((t - now) / 1000, 24 * 3600)) : undefined;
}

const MODEL_GONE = /model.{0,3}not.{0,3}found|does not exist|not a valid model|invalid model|unsupported model|no endpoints|decommissioned|deprecated model/i;
const CAP_IMAGE = /(image|vision|multimodal|image_url).{0,40}(not supported|unsupported|does not support|not available)|does not support (image|vision)/i;
const PAYMENT = /insufficient.{0,12}(credit|fund|balance)|billing|payment required|credit balance|too low|\b402\b/i;

/** Pure: klasyfikacja błędu dostawcy do klasy działania AutoCore. */
export function classifyFailure(e: unknown, now = Date.now()): ClassifiedFailure {
  const msg = errMsg(e);
  const status = statusOf(e);
  const retryAfterSec = retryAfterOf(e, now);
  const out = (kind: FailureKind): ClassifiedFailure => ({ kind, ...(status ? { status } : {}), ...(retryAfterSec !== undefined ? { retryAfterSec } : {}) });
  if (/timeout|timed?.?out|abort|nie odpowiada|milczy/i.test(msg)) return out("timeout");
  if (status === 402 || PAYMENT.test(msg)) return out("payment");
  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid.?api.?key|api key not valid|invalid authentication|incorrect api key/i.test(msg)) return out("auth");
  if (status === 429 || /rate.?limit|too many requests|quota|exceeded/i.test(msg)) return out("rate");
  if (MODEL_GONE.test(msg) || (status === 404 && /model/i.test(msg))) return out("model_missing");
  if (CAP_IMAGE.test(msg)) return out("capability");
  if (status && status >= 500) return out("server");
  if (/overloaded|unavailable|bad gateway|service unavailable/i.test(msg)) return out("server");
  if (/failed to fetch|load failed|network|econnrefused|err_connection|could not connect|unable to connect/i.test(msg)) return out("network");
  if (status === 400 || status === 404 || status === 422) return out("bad_request");
  return out("unknown");
}

const kk = (p: ProviderId, key: string) => `${p}:${keyFingerprint(key)}`;
const mk = (p: ProviderId, model: string) => `${p}|${model}`;

/** Zapisz porażkę i zwróć jej klasę. `hasImage` pozwala przypisać błąd możliwości do wizji. */
export function reportFailure(p: ProviderId, model: string, key: string, e: unknown, now = Date.now()): ClassifiedFailure {
  const c = classifyFailure(e, now);
  const st = S();
  const pe = (st.providers[p] ??= { fails: 0, until: 0, ok: 0, ko: 0 });
  pe.ko++; pe.lastKind = c.kind;
  const keyed = key && key !== "local";
  if (keyed && (c.kind === "auth" || c.kind === "payment" || c.kind === "rate")) {
    const prev = st.keys[kk(p, key)];
    const hits = prev && prev.kind === c.kind ? prev.hits + 1 : 1;
    const until = c.kind === "auth" ? FOREVER
      : c.kind === "payment" ? now + 24 * H
      : now + (c.retryAfterSec !== undefined ? c.retryAfterSec * 1000 : Math.min(60_000 * 2 ** (hits - 1), 15 * 60_000));
    st.keys[kk(p, key)] = { kind: c.kind, until, hits, at: now };
  } else if (c.kind === "model_missing") {
    st.models[mk(p, model)] = { kind: "model_missing", until: now + 24 * H, at: now };
  } else if (c.kind === "capability") {
    st.models[mk(p, model)] = { kind: "capability", cap: "vision", until: now + 7 * 24 * H, at: now };
  } else if (c.kind === "server" || c.kind === "timeout") {
    pe.fails++;
    if (pe.fails >= 3) pe.until = now + Math.min(15_000 * 2 ** (pe.fails - 3), 10 * 60_000);
  }
  persist();
  return c;
}

/** Zapisz sukces: zeruje serię błędów dostawcy i limit klucza; aktualizuje EWMA latencji. */
export function reportSuccess(p: ProviderId, model: string, key: string, latencyMs?: number, now = Date.now()): void {
  const st = S();
  const pe = (st.providers[p] ??= { fails: 0, until: 0, ok: 0, ko: 0 });
  pe.ok++; pe.fails = 0; pe.until = 0; pe.lastOkAt = now;
  if (typeof latencyMs === "number" && latencyMs >= 0) pe.latencyEwma = pe.latencyEwma === undefined ? latencyMs : Math.round(pe.latencyEwma * 0.7 + latencyMs * 0.3);
  if (key && key !== "local") delete st.keys[kk(p, key)];
  const m = st.models[mk(p, model)];
  if (m && m.kind === "model_missing") delete st.models[mk(p, model)];
  persist();
}

export function keyUsable(p: ProviderId, key: string, now = Date.now()): boolean {
  if (!key || key === "local") return true;
  const e = S().keys[kk(p, key)];
  return !e || e.until <= now;
}

export function modelUsable(p: ProviderId, model: string, opts: { needsVision?: boolean } = {}, now = Date.now()): boolean {
  const e = S().models[mk(p, model)];
  if (!e || e.until <= now) return true;
  if (e.kind === "capability") return !opts.needsVision;
  return false;
}

export function providerUsable(p: ProviderId, now = Date.now()): boolean {
  const e = S().providers[p];
  return !e || e.until <= now;
}

/** Ludzki powód niedostępności (dla komunikatu failoveru) — bez sekretów. null = dostępny. */
export function blockReason(p: ProviderId, model: string, keys: string[], opts: { needsVision?: boolean } = {}, now = Date.now()): string | null {
  if (!providerUsable(p, now)) return "seria błędów serwera — chwilowa przerwa (backoff)";
  if (!modelUsable(p, model, opts, now)) return S().models[mk(p, model)]?.kind === "capability" ? "model nie obsługuje obrazów" : "model niedostępny (usunięty u dostawcy)";
  const real = keys.filter((k) => k && k !== "local");
  if (real.length && real.every((k) => !keyUsable(p, k, now))) {
    const kinds = real.map((k) => S().keys[kk(p, k)]?.kind);
    if (kinds.includes("rate")) return "limit zapytań — czekam na odnowienie";
    if (kinds.includes("payment")) return "brak środków na koncie dostawcy";
    return "klucz odrzucony (401/403) — wymaga nowego klucza";
  }
  return null;
}

export interface ProviderHealthView { provider: string; ok: number; ko: number; latencyEwma?: number; lastKind?: FailureKind; lastOkAt?: number; backoffUntil?: number; badKeys: number }
/** Migawka do UI/diagnostyki (bez odcisków kluczy). */
export function healthSnapshot(now = Date.now()): ProviderHealthView[] {
  const st = S();
  return Object.entries(st.providers).map(([provider, e]) => ({
    provider, ok: e.ok, ko: e.ko, latencyEwma: e.latencyEwma, lastKind: e.lastKind, lastOkAt: e.lastOkAt,
    ...(e.until > now ? { backoffUntil: e.until } : {}),
    badKeys: Object.entries(st.keys).filter(([k, v]) => k.startsWith(provider + ":") && v.until > now).length,
  }));
}

/** Niezawodność 0..1 (Laplace) — wejście do rankingu routera. */
export function reliabilityOf(p: ProviderId): number {
  const e = S().providers[p];
  return e ? (e.ok + 1) / (e.ok + e.ko + 2) : 0.5;
}
export function latencyOf(p: ProviderId): number | undefined { return S().providers[p]?.latencyEwma; }
export function providerSampleCount(p: ProviderId): number { const e = S().providers[p]; return e ? e.ok + e.ko : 0; }
export function providerCounters(p: ProviderId): { ok: number; ko: number } { const e = S().providers[p]; return e ? { ok: e.ok, ko: e.ko } : { ok: 0, ko: 0 }; }

/** Tylko testy/diagnostyka: wyczyść stan. */
export function resetHealth(): void { state = { keys: {}, models: {}, providers: {} }; persist(); }
