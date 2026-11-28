// === JARVIS FLOW AUDIO — 100% offline proceduralny generator dźwięku skupienia ===
// Zero zewnętrznych plików MP3/WAV, zero internetu, czysta synteza Web Audio API (ES2019/S9-safe).
// Tryby: cisza (off), głęboki szum brązowy (brown), ciepły deszcz (rain), fala binauralna Alpha 10 Hz (alpha).

export type FocusSoundMode = "off" | "brown" | "rain" | "alpha";

export interface FocusAudioController {
  setMode: (mode: FocusSoundMode, volume?: number) => boolean;
  setVolume: (volume: number) => void;
  stop: () => void;
  currentMode: () => FocusSoundMode;
}

export function createFocusAudioController(): FocusAudioController {
  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let activeNodes: AudioNode[] = [];
  let mode: FocusSoundMode = "off";
  let currentVol = 0.25;

  const stopNodes = () => {
    for (const node of activeNodes) {
      try {
        if ("stop" in node && typeof (node as AudioScheduledSourceNode).stop === "function") {
          (node as AudioScheduledSourceNode).stop();
        }
        node.disconnect();
      } catch {
        /* ignore already-stopped nodes */
      }
    }
    activeNodes = [];
  };

  const ensureContext = (): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.0001;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }
    return ctx;
  };

  const buildNoiseBuffer = (audio: AudioContext, seconds: number, kind: "brown" | "pink"): AudioBuffer => {
    const length = Math.max(audio.sampleRate, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(2, length, audio.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = buffer.getChannelData(ch);
      if (kind === "brown") {
        let last = 0;
        for (let i = 0; i < length; i += 1) {
          const white = Math.random() * 2 - 1;
          last = (last + 0.02 * white) / 1.02;
          data[i] = Math.max(-1, Math.min(1, last * 3.2));
        }
      } else {
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < length; i += 1) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + white * 0.099046;
          b1 = 0.96300 * b1 + white * 0.2965164;
          b2 = 0.57000 * b2 + white * 1.0526913;
          data[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + white * 0.1848) * 0.16));
        }
      }
    }
    return buffer;
  };

  const applyVolume = (vol: number) => {
    currentVol = Math.max(0, Math.min(1, vol));
    if (!ctx || !masterGain) return;
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(Math.max(0.0001, currentVol * 0.45), now, 0.08);
  };

  const setMode = (nextMode: FocusSoundMode, volume?: number): boolean => {
    if (typeof volume === "number") currentVol = Math.max(0, Math.min(1, volume));
    stopNodes();
    mode = nextMode;
    if (nextMode === "off") {
      if (ctx && masterGain) {
        masterGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.06);
      }
      return true;
    }

    const audio = ensureContext();
    if (!audio || !masterGain) {
      mode = "off";
      return false;
    }

    if (nextMode === "brown") {
      const src = audio.createBufferSource();
      src.buffer = buildNoiseBuffer(audio, 4, "brown");
      src.loop = true;
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 420;
      src.connect(lp);
      lp.connect(masterGain);
      src.start();
      activeNodes = [src, lp];
    } else if (nextMode === "rain") {
      const src = audio.createBufferSource();
      src.buffer = buildNoiseBuffer(audio, 4, "pink");
      src.loop = true;
      const bp = audio.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1050;
      bp.Q.value = 0.65;
      const lp = audio.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      src.connect(bp);
      bp.connect(lp);
      lp.connect(masterGain);
      src.start();
      activeNodes = [src, bp, lp];
    } else if (nextMode === "alpha") {
      // Miękka fala binauralna Alpha (10 Hz różnicy: 196 Hz L / 206 Hz R) + delikatne tło brązowe.
      const merger = audio.createChannelMerger(2);
      const oscL = audio.createOscillator();
      const oscR = audio.createOscillator();
      const toneGain = audio.createGain();
      oscL.type = "sine";
      oscR.type = "sine";
      oscL.frequency.value = 196;
      oscR.frequency.value = 206;
      toneGain.gain.value = 0.28;
      oscL.connect(merger, 0, 0);
      oscR.connect(merger, 0, 1);
      merger.connect(toneGain);
      toneGain.connect(masterGain);

      const bed = audio.createBufferSource();
      bed.buffer = buildNoiseBuffer(audio, 4, "brown");
      bed.loop = true;
      const bedLp = audio.createBiquadFilter();
      bedLp.type = "lowpass";
      bedLp.frequency.value = 280;
      const bedGain = audio.createGain();
      bedGain.gain.value = 0.45;
      bed.connect(bedLp);
      bedLp.connect(bedGain);
      bedGain.connect(masterGain);

      oscL.start();
      oscR.start();
      bed.start();
      activeNodes = [oscL, oscR, merger, toneGain, bed, bedLp, bedGain];
    }

    applyVolume(currentVol);
    return true;
  };

  const stop = () => {
    stopNodes();
    mode = "off";
    if (ctx) {
      const toClose = ctx;
      ctx = null;
      masterGain = null;
      void toClose.close().catch(() => {});
    }
  };

  return {
    setMode,
    setVolume: applyVolume,
    stop,
    currentMode: () => mode,
  };
}
