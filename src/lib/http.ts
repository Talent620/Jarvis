// fetch z twardym limitem czasu (AbortController). Publiczne API (pogoda, kursy)
// potrafią wisieć — bez tego zapytanie blokowałoby się do ~2 min (default przeglądarki),
// zamrażając np. poranny briefing. Przy przekroczeniu czasu rzuca, jak zwykły błąd sieci.
export async function fetchTimeout(url: string, opts: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
