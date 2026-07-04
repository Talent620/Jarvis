// === Arbiter sesji audio: JEDEN właściciel mikrofonu naraz ===
// Problem: główny mikrofon, Słuchawki, Live i Szef miały osobne cykle nasłuchu — przełączenie
// (np. auto-otwarcie Słuchawek po podłączeniu) potrafiło zostawić główny listener aktywny.
// Tu jest lekki, czysty arbiter: przejęcie przez nowego właściciela PREEMPTUJE poprzedniego
// (woła jego callback zwalniający zasoby). Maksymalnie jeden właściciel w danej chwili.

export type VoiceOwner = "main" | "headset" | "live" | "boss" | "permission";

let currentOwner: VoiceOwner | null = null;
let releaseCb: (() => void) | null = null;
const subs = new Set<(owner: VoiceOwner | null) => void>();

function notify() { subs.forEach((cb) => { try { cb(currentOwner); } catch { /* izoluj */ } }); }

/** Kto teraz „trzyma" mikrofon (albo null). */
export function currentVoiceOwner(): VoiceOwner | null { return currentOwner; }

/**
 * Przejmij mikrofon dla `owner`. Jeśli ktoś inny go trzymał — najpierw zwalniamy poprzednika
 * (jego onRelease), więc nie zostają dwa aktywne nasłuchy. `onRelease` to sposób tego
 * właściciela na zatrzymanie własnego mikrofonu/TTS/timerów, gdy zostanie wyparty.
 */
export function acquireVoice(owner: VoiceOwner, onRelease?: () => void): void {
  if (currentOwner && currentOwner !== owner && releaseCb) {
    const prev = releaseCb;
    releaseCb = null;
    try { prev(); } catch { /* izoluj — preempcja nie może wywalić nowego właściciela */ }
  }
  currentOwner = owner;
  releaseCb = onRelease || null;
  notify();
}

/** Zwolnij mikrofon (tylko jeśli `owner` faktycznie go trzyma — inaczej no-op). */
export function releaseVoice(owner: VoiceOwner): void {
  if (currentOwner !== owner) return;
  currentOwner = null;
  releaseCb = null;
  notify();
}

/** Subskrybuj zmianę właściciela (UI/diagnostyka). Zwraca funkcję odpinającą. */
export function onVoiceOwnerChange(cb: (owner: VoiceOwner | null) => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}
