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
  const external = opts.signal;
  if (external?.aborted) throw new DOMException("Zatrzymano wykonanie.", "AbortError");
  const ctrl = new AbortController();
  const cleanup = () => external?.removeEventListener("abort", stop);
  const stop = () => { ctrl.abort(); clearTimeout(timer); cleanup(); };
  // Keep cancellation connected while the caller consumes a streamed response.
  // The deadline bounds listener lifetime even for an unread body.
  const timer = setTimeout(stop, ms);
  external?.addEventListener("abort", stop, { once: true });
  try {
    const response = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!external) clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer); cleanup(); throw error;
  }
}
