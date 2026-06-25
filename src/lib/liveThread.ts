// === Ciągłość rozmowy na żywo (Tryb Słuchawki) ===
// Naturalna rozmowa nie zaczyna się za każdym razem od zera. Zapisujemy ostatnie tury rozmowy
// głosowej i — gdy wrócisz w rozsądnym oknie czasu (domyślnie 30 min) — JARVIS kontynuuje wątek
// zamiast pytać o wszystko od nowa. Po dłuższej przerwie zaczynamy świeżo (pamięć długoterminowa
// o Tobie i tak działa przez askJarvis). Logika decyzji jest czysta i testowalna.

import { loadJson, saveJson } from "./lsJson";
import type { Msg } from "./providers/types";

const KEY = "jarvis.live.thread.v1";
export const BOSS_THREAD_KEY = "jarvis.boss.thread.v1"; // osobny wątek dla Trybu Szefa
const FRESH_MS = 30 * 60 * 1000; // 30 minut — w tym oknie kontynuujemy tę samą rozmowę
const MAX_TURNS = 16; // tyle ostatnich wiadomości trzymamy (kontekst bez rozdęcia)

export interface StoredThread {
  at: number; // znacznik ostatniej aktywności
  msgs: Msg[];
}

/** Czysta decyzja: czy zapisany wątek jest wciąż „świeży" i można go wznowić. */
export function freshThread(stored: StoredThread | null, now: number, maxAgeMs = FRESH_MS): Msg[] {
  if (!stored || !Array.isArray(stored.msgs) || stored.msgs.length === 0) return [];
  if (!stored.at || now - stored.at > maxAgeMs) return [];
  return stored.msgs.slice(-MAX_TURNS);
}

/** Wczytaj wątek rozmowy, jeśli świeży; inaczej pustą historię (świeży start). */
export function loadLiveThread(now = Date.now(), key = KEY): Msg[] {
  return freshThread(loadJson<StoredThread | null>(key, null), now);
}

/** Zapisz bieżący wątek (ostatnie tury) ze znacznikiem czasu. */
export function saveLiveThread(msgs: Msg[], now = Date.now(), key = KEY): void {
  saveJson(key, { at: now, msgs: msgs.slice(-MAX_TURNS) });
}

/** Wyczyść wątek (przycisk „Nowa rozmowa"). */
export function clearLiveThread(key = KEY): void {
  saveJson(key, { at: 0, msgs: [] });
}
