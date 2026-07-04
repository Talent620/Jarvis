// === Bezpieczny JSON w localStorage — jedno źródło dla drobnych „pierścieni"/map ===
// Wspólny try/catch + JSON parse/stringify używany przez guardianHistory, bossMemory,
// iqProbe, habit, tips (wcześniej każdy miał własny, identyczny blok). Logikę cappowania/
// dedup zostawiamy w modułach (różna semantyka) — tu tylko odporne I/O (SSR/prywatny tryb/quota).

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* brak miejsca / prywatny tryb / SSR — pomiń (best-effort) */
  }
}
