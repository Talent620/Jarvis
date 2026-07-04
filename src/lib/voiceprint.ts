// === Odcisk głosu (speaker fingerprint) — reaguj tylko na MÓJ głos ===
// Standard rozpoznawania mówcy to cechy widmowe (MFCC / log-mel). Korzystamy z
// FFT wbudowanego w przeglądarkę (AnalyserNode) — bez pobierania modeli, w 100%
// lokalnie i prywatnie. Z próbek Twojego głosu budujemy „profil", a każdą
// wypowiedź porównujemy kosinusowo. To NIE jest biometria bankowa, ale skutecznie
// odsiewa inne głosy, telewizor i (w dużej mierze) tło — a wszystko offline.
//
// Uczciwie: najmocniejszą dokładność daje sieć neuronowa (np. Picovoice Eagle);
// tu stawiamy na lekkość, prywatność i zero pobierania.

const F_MIN = 90;
const F_MAX = 7600;

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1);

/**
 * Redukcja widma (dB z AnalyserNode) do N pasm mel — zwarty wektor cech głosu.
 * freqDb: getFloatFrequencyData (długość = fftSize/2), wartości w dB.
 */
export function melBands(freqDb: Float32Array, sampleRate: number, nBands = 24): number[] {
  const bins = freqDb.length;
  const nyquist = sampleRate / 2;
  const melMin = hzToMel(F_MIN);
  const melMax = hzToMel(Math.min(F_MAX, nyquist));
  const out: number[] = [];
  for (let b = 0; b < nBands; b++) {
    const loHz = melToHz(melMin + ((melMax - melMin) * b) / nBands);
    const hiHz = melToHz(melMin + ((melMax - melMin) * (b + 1)) / nBands);
    const loBin = Math.max(0, Math.floor((loHz / nyquist) * bins));
    const hiBin = Math.min(bins - 1, Math.ceil((hiHz / nyquist) * bins));
    let sum = 0;
    let cnt = 0;
    for (let i = loBin; i <= hiBin; i++) {
      const v = freqDb[i];
      if (Number.isFinite(v)) { sum += v; cnt++; }
    }
    out.push(cnt ? sum / cnt : -120);
  }
  return out;
}

/** Normalizacja wektora (odejmij średnią, podziel przez normę) — odporność na głośność. */
export function normalize(v: number[]): number[] {
  if (!v.length) return v;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const c = v.map((x) => x - mean);
  const norm = Math.sqrt(c.reduce((a, b) => a + b * b, 0)) || 1;
  return c.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Uśrednij wektory ramek w jeden embedding wypowiedzi (po normalizacji). */
export function embed(frames: number[][]): number[] {
  if (!frames.length) return [];
  const n = frames[0].length;
  const acc = new Array(n).fill(0);
  for (const f of frames) {
    const nf = normalize(f);
    for (let i = 0; i < n; i++) acc[i] += nf[i];
  }
  return normalize(acc.map((x) => x / frames.length));
}

/** Zbuduj profil z kilku próbek (embeddingów) — uśredniony, znormalizowany. */
export function buildProfile(samples: number[][]): number[] {
  return embed(samples);
}

/** Dopasowanie wypowiedzi do profilu (0..1). Próg ~0.6–0.75 zwykle dobry. */
export function matchScore(profile: number[], utterance: number[]): number {
  if (!profile.length || !utterance.length) return 0;
  return Math.max(0, cosine(normalize(profile), normalize(utterance)));
}
