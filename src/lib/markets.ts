// Finanse/rynki — darmowe, bez kluczy i bez problemów z CORS:
//  • krypto: CoinGecko (publiczne API),
//  • kursy walut: open.er-api.com (publiczne, bez klucza).
// Czysta funkcja formatująca + pobieranie best-effort (zwraca tekst dla czatu).

const COIN_IDS: Record<string, string> = {
  btc: "bitcoin", bitcoin: "bitcoin",
  eth: "ethereum", ethereum: "ethereum",
  sol: "solana", solana: "solana",
  xrp: "ripple", ada: "cardano", doge: "dogecoin", bnb: "binancecoin",
};

export function formatPrice(n: number): string {
  if (!isFinite(n)) return "?";
  return n >= 100 ? n.toLocaleString("pl-PL", { maximumFractionDigits: 0 })
    : n >= 1 ? n.toFixed(2) : n.toFixed(4);
}

/** Notowania krypto (w PLN i USD) + zmiana 24h. */
export async function getCrypto(symbols: string[]): Promise<string> {
  const ids = [...new Set(symbols.map((s) => COIN_IDS[s.toLowerCase()]).filter(Boolean))];
  if (!ids.length) return "Podaj symbole krypto, np. BTC, ETH, SOL.";
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd,pln&include_24hr_change=true`);
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return "Notowania krypto chwilowo niedostępne.";
    const lines = ids.map((id) => {
      const c = d[id];
      if (!c) return `${id}: brak danych`;
      const ch = c.usd_24h_change;
      const arrow = ch >= 0 ? "▲" : "▼";
      return `${id.toUpperCase()}: $${formatPrice(c.usd)} / ${formatPrice(c.pln)} zł ${arrow}${Math.abs(ch || 0).toFixed(1)}% (24h)`;
    });
    return lines.join("\n");
  } catch {
    return "Brak połączenia z serwisem notowań.";
  }
}

/** Kurs waluty względem PLN (lub dowolnej bazy). */
export async function getRate(from = "USD", to = "PLN"): Promise<string> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from.toUpperCase())}`);
    const d = await res.json().catch(() => null);
    const rate = d?.rates?.[to.toUpperCase()];
    if (!rate) return "Nie udało się pobrać kursu.";
    return `1 ${from.toUpperCase()} = ${Number(rate).toFixed(3)} ${to.toUpperCase()}`;
  } catch {
    return "Brak połączenia z serwisem kursów.";
  }
}
