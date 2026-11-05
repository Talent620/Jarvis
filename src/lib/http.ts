// fetch z twardym limitem czasu (AbortController). Publiczne API (pogoda, kursy)
// potrafią wisieć — bez tego zapytanie blokowałoby się do ~2 min (default przeglądarki),
// zamrażając np. poranny briefing. Przy przekroczeniu czasu rzuca, jak zwykły błąd sieci.
// Nagłówek tokenu aplikacji do BFF — wysyłany TYLKO przez proxy, gdy build podał
// VITE_APP_TOKEN (musi zgadzać się z sekretem APP_TOKEN workera). Puste = brak nagłówka.
export function appTokenHeader(): Record<string, string> {
  try {
    const t = (import.meta as { env?: Record<string, string> }).env?.VITE_APP_TOKEN?.trim();
    return t ? { "x-app-token": t } : {};
  } catch {
    return {};
  }
}

export async function fetchTimeout(url: string, opts: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  if (opts.signal?.aborted) abort();
  else opts.signal?.addEventListener("abort", abort, { once: true });
  // Native composition also keeps caller cancellation attached while a response body streams.
  const signal = opts.signal && typeof AbortSignal.any === "function" ? AbortSignal.any([ctrl.signal, opts.signal]) : ctrl.signal;
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal });
  } finally {
    clearTimeout(t);
    opts.signal?.removeEventListener("abort", abort);
  }
}
