// Rdzeń niezawodności — prymitywy odporności współdzielone przez warstwę sieci/AI.
// Czyste, testowalne, bez efektów ubocznych poza opcjonalnym cache w IndexedDB (Faza A).
//
// Zawiera: wykładniczy backoff z jitterem, deduplikację żądań w locie, bezpiecznik
// (circuit breaker) per-klucz i cache warstwowy (RAM + opcjonalnie IndexedDB, z TTL).

import { idbGet, idbSet } from "./db";

// --- Wykładniczy backoff z jitterem ---

export interface BackoffOpts {
  /** Ile PONOWNYCH prób po pierwszej (łącznie attempts = retries+1). Domyślnie 2. */
  retries?: number;
  /** Bazowe opóźnienie (ms) przed 1. ponowieniem. Domyślnie 400. */
  baseMs?: number;
  /** Mnożnik wzrostu opóźnienia. Domyślnie 2. */
  factor?: number;
  /** Górny limit pojedynczego opóźnienia (ms). Domyślnie 5000. */
  maxMs?: number;
  /** Czy dodać losowy jitter (rozprasza burze ponowień). Domyślnie true. */
  jitter?: boolean;
  /** Predykat: czy dla tego błędu ponawiać. Domyślnie zawsze. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Wstrzykiwalny sleep (do testów). */
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Uruchom `fn` z wykładniczym backoffem. Zwraca wynik albo rzuca OSTATNI błąd. */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOpts = {}): Promise<T> {
  const { retries = 2, baseMs = 400, factor = 2, maxMs = 5000, jitter = true, shouldRetry = () => true, sleepFn = defaultSleep } = opts;
  let attempt = 0;
  let lastErr: unknown;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt >= retries || !shouldRetry(e, attempt)) break;
      const raw = Math.min(maxMs, baseMs * Math.pow(factor, attempt));
      const delay = jitter ? raw / 2 + Math.random() * (raw / 2) : raw;
      await sleepFn(delay);
      attempt++;
    }
  }
  throw lastErr;
}

// --- Deduplikacja żądań w locie ---
// Identyczne równoległe wywołania (ten sam klucz) współdzielą JEDNĄ obietnicę — koniec
// podwójnych zapytań (np. status API odpytywany z kilku miejsc naraz).

const inflight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function inflightCount(): number {
  return inflight.size;
}

// --- Bezpiecznik (circuit breaker) per-klucz ---
// Po `threshold` kolejnych awariach „otwiera się" na `openMs` (szybko pomijamy padniętego
// dostawcę). Po tym czasie wpuszcza jedną próbę (half-open): sukces zamyka, błąd otwiera znów.

export type BreakerState = "closed" | "open" | "half";

export class CircuitBreaker {
  private fails = new Map<string, number>();
  private openUntil = new Map<string, number>();
  constructor(
    private threshold = 4,
    private openMs = 30_000,
    private now: () => number = Date.now,
  ) {}

  /** Czy próba przez ten klucz jest dozwolona (closed lub half-open). */
  canPass(key: string): boolean {
    const until = this.openUntil.get(key) || 0;
    return until <= this.now();
  }

  state(key: string): BreakerState {
    const until = this.openUntil.get(key) || 0;
    if (until > this.now()) return "open";
    if (until > 0) return "half"; // minął czas otwarcia, czekamy na próbę
    return "closed";
  }

  onSuccess(key: string): void {
    this.fails.delete(key);
    this.openUntil.delete(key);
  }

  onFailure(key: string): void {
    const n = (this.fails.get(key) || 0) + 1;
    if (n >= this.threshold) {
      this.openUntil.set(key, this.now() + this.openMs);
      this.fails.set(key, 0);
    } else {
      this.fails.set(key, n);
    }
  }

  reset(): void {
    this.fails.clear();
    this.openUntil.clear();
  }
}

// --- Cache warstwowy (RAM + opcjonalnie IndexedDB) z TTL ---

interface CacheEntry<T> {
  v: T;
  exp: number;
}

const mem = new Map<string, CacheEntry<unknown>>();

/**
 * Zwróć z cache albo policz przez `fn` i zapisz (TTL). `persist` dokłada warstwę
 * IndexedDB (przeżywa restart). Błąd `fn` NIE jest cache'owany.
 */
export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlMs: number,
  opts: { persist?: boolean } = {},
): Promise<T> {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.exp > now) return hit.v as T;
  if (opts.persist) {
    const p = await idbGet<CacheEntry<T>>(`cache:${key}`);
    if (p && p.exp > now) {
      mem.set(key, p);
      return p.v;
    }
  }
  const v = await fn();
  const entry: CacheEntry<T> = { v, exp: now + ttlMs };
  mem.set(key, entry);
  if (opts.persist) void idbSet(`cache:${key}`, entry);
  return v;
}

export function invalidateCache(key: string): void {
  mem.delete(key);
}

export function clearMemCache(): void {
  mem.clear();
}
