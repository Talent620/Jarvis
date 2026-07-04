// Fotopletyzmografia (PPG): z serii jasności kanału czerwonego (palec na
// aparacie + latarka) oszacuj tętno. Czysta funkcja — łatwa do testów.

export interface PpgSample {
  t: number; // ms
  v: number; // średnia jasność kanału R (0..255)
}

export function estimateBpm(samples: PpgSample[]): number | null {
  if (samples.length < 60) return null;
  // Pomiń pierwsze 2 s (rozruch latarki / stabilizacja).
  const t0 = samples[0].t + 2000;
  const s = samples.filter((x) => x.t >= t0);
  if (s.length < 60) return null;

  const dt = (s[s.length - 1].t - s[0].t) / (s.length - 1); // ms na próbkę
  if (!(dt > 0)) return null;
  const vals = s.map((x) => x.v);

  // Detrend: odejmij średnią ruchomą z ~0,75 s (usuwa dryf jasności).
  const win = Math.max(3, Math.round(750 / dt));
  const detr: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    let a = 0;
    let c = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(vals.length - 1, i + win); j++) {
      a += vals[j];
      c++;
    }
    detr.push(vals[i] - a / c);
  }

  // Wykryj szczyty (lokalne maksima > 0) z okresem refrakcji (min 0,3 s = max 200 bpm).
  const refractory = Math.max(1, Math.round(300 / dt));
  const peaks: number[] = [];
  for (let i = 1; i < detr.length - 1; i++) {
    if (detr[i] > 0 && detr[i] >= detr[i - 1] && detr[i] > detr[i + 1]) {
      if (!peaks.length || i - peaks[peaks.length - 1] >= refractory) peaks.push(i);
    }
  }
  if (peaks.length < 4) return null;

  // Mediana odstępów między szczytami → odporne tętno.
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) intervals.push((peaks[i] - peaks[i - 1]) * dt);
  intervals.sort((a, b) => a - b);
  const med = intervals[Math.floor(intervals.length / 2)];
  const bpm = Math.round(60000 / med);
  if (bpm < 40 || bpm > 220) return null;
  return bpm;
}
