import { fetchTimeout } from "./http";
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
  // Zachowaj symbol użytkownika (BTC), nie kanoniczne id CoinGecko (bitcoin). Dedup po id.
  const seen = new Map<string, string>();
  for (const s of symbols) {
    const id = COIN_IDS[s.toLowerCase()];
    if (id && !seen.has(id)) seen.set(id, s.toUpperCase());
  }
  const pairs = [...seen.entries()];
  if (!pairs.length) return "Podaj symbole krypto, np. BTC, ETH, SOL.";
  const ids = pairs.map(([id]) => id);
  try {
    const res = await fetchTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd,pln&include_24hr_change=true`);
    const d = await res.json().catch(() => null);
    if (!res.ok || !d) return "Notowania krypto chwilowo niedostępne.";
    const lines = pairs.map(([id, sym]) => {
      const c = d[id];
      if (!c) return `${sym}: brak danych`;
      const ch = c.usd_24h_change;
      // Gdy API nie poda zmiany 24h — nie pokazuj fałszywej strzałki w dół / „0.0%".
      const hasCh = typeof ch === "number" && isFinite(ch);
      const chTxt = hasCh ? ` ${ch >= 0 ? "▲" : "▼"}${Math.abs(ch).toFixed(1)}% (24h)` : "";
      return `${sym}: $${formatPrice(c.usd)} / ${formatPrice(c.pln)} zł${chTxt}`;
    });
    return lines.join("\n");
  } catch {
    return "Brak połączenia z serwisem notowań.";
  }
}

/** Kurs waluty względem PLN (lub dowolnej bazy). */
export async function getRate(from = "USD", to = "PLN"): Promise<string> {
  try {
    const res = await fetchTimeout(`https://open.er-api.com/v6/latest/${encodeURIComponent(from.toUpperCase())}`);
    const d = await res.json().catch(() => null);
    const rate = d?.rates?.[to.toUpperCase()];
    if (!rate) return "Nie udało się pobrać kursu.";
    return `1 ${from.toUpperCase()} = ${Number(rate).toFixed(3)} ${to.toUpperCase()}`;
  } catch {
    return "Brak połączenia z serwisem kursów.";
  }
}
