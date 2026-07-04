// Globalny poziom głośności mowy JARVIS-a (0..1) — napędza animację orbu,
// dzięki czemu kula „mówi" w rytm realnego dźwięku.
let level = 0;
const subs = new Set<(v: number) => void>();

export function setLevel(v: number): void {
  level = v;
  subs.forEach((fn) => fn(v));
}

export function getLevel(): number {
  return level;
}

export function subscribeLevel(fn: (v: number) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
