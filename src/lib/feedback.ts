import { store } from "./store";

// Subtelne sprzężenie zwrotne klasy premium: krótkie tony HUD (WebAudio, bez
// żadnych plików) + wibracje. Wszystko wyłączalne w ustawieniach.

let actx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    if (!actx) actx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  } catch {
    return null;
  }
}

type Cue = "tap" | "send" | "confirm" | "wake" | "error";

const TONES: Record<Cue, number[]> = {
  tap: [520],
  send: [600, 760], // delikatny dwuton w górę
  confirm: [660, 880],
  wake: [880, 1320], // „systemy online"
  error: [200, 150],
};

export function cue(kind: Cue = "tap"): void {
  if (store.settings.soundCues === false) return;
  const c = getCtx();
  if (!c) return;
  const notes = TONES[kind];
  notes.forEach((freq, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    const t0 = c.currentTime + i * 0.07;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + 0.18);
  });
}

export function buzz(pattern: number | number[] = 16): void {
  if (store.settings.haptics === false) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* brak wsparcia */
  }
}

// Połączone, dopasowane do rodzaju zdarzenia.
export function feedback(kind: Cue = "tap"): void {
  cue(kind);
  buzz(kind === "error" ? [20, 50, 20] : kind === "confirm" || kind === "wake" ? [12, 30, 12] : 14);
}
