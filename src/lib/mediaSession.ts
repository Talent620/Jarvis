// Sterowanie z przycisków słuchawek (Bluetooth) przez Media Session API.
// Aby system kierował przyciski (play/pause/next/prev) do JARVIS-a, aplikacja
// musi „posiadać" sesję mediów — trzymamy więc cichą, zapętloną ścieżkę audio.
// Dzięki temu klik na słuchawkach = wywołanie JARVIS-a (gadaj), a next/prev =
// dodatkowe akcje (np. powtórz / przerwij). Potwierdzone: web.dev Media Session.

let audioEl: HTMLAudioElement | null = null;
let silentUrl: string | null = null;

// Krótki, cichy plik WAV (PCM 8-bit mono) budowany w pamięci — trzyma „audio focus".
function silentWavUrl(): string {
  if (silentUrl) return silentUrl;
  const sampleRate = 8000;
  const samples = 8000; // 1 s ciszy (zapętlone)
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128); // 128 = cisza dla PCM 8-bit
  silentUrl = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return silentUrl;
}

export interface MediaHandlers {
  /** Klik play/pause na słuchawkach — „gadaj do JARVIS-a" / przerwij mówienie. */
  onToggle?: () => void;
  /** Następny — np. powtórz pytanie / następny utwór. */
  onNext?: () => void;
  /** Poprzedni — np. anuluj / poprzedni utwór. */
  onPrev?: () => void;
}

/** Włącz przechwytywanie przycisków słuchawek. Zwraca true, gdy się udało. */
export async function startHeadsetControls(h: MediaHandlers): Promise<boolean> {
  try {
    if (!audioEl) {
      audioEl = new Audio(silentWavUrl());
      audioEl.loop = true;
      audioEl.volume = 0.0001;
    }
    await audioEl.play().catch(() => {});
    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      ms.metadata = new MediaMetadata({ title: "JARVIS — Tryb Słuchawki", artist: "Asystent głosowy", album: "Centrum dowodzenia" });
      ms.setActionHandler("play", () => h.onToggle?.());
      ms.setActionHandler("pause", () => h.onToggle?.());
      try { ms.setActionHandler("nexttrack", () => h.onNext?.()); } catch { /* nieobsługiwane */ }
      try { ms.setActionHandler("previoustrack", () => h.onPrev?.()); } catch { /* nieobsługiwane */ }
      ms.playbackState = "playing";
    }
    return true;
  } catch {
    return false;
  }
}

export function stopHeadsetControls(): void {
  try {
    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      for (const a of ["play", "pause", "nexttrack", "previoustrack"] as const) {
        try { ms.setActionHandler(a, null); } catch { /* ignore */ }
      }
      ms.playbackState = "none";
    }
    audioEl?.pause();
  } catch {
    /* ignore */
  }
}
