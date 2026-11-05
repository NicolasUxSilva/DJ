import type { PcmSource } from '../analysis';

/** Deterministic PRNG so tests are stable. */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeSource(channels: Float32Array[], sampleRate: number): PcmSource {
  return {
    sampleRate,
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData: (c: number) => channels[c],
  };
}

export interface Groove {
  /** Hit positions inside one bar, in beats (0..4). */
  kick: number[];
  snare: number[];
  hat: number[];
  /** Bars per repetition when the pattern spans two bars (second bar uses kick2/snare2). */
  kick2?: number[];
  snare2?: number[];
  bass?: boolean;
}

const range = (step: number) => Array.from({ length: Math.round(4 / step) }, (_, i) => i * step);

export const GROOVES: Record<string, Groove> = {
  house: { kick: [0, 1, 2, 3], snare: [1, 3], hat: [0.5, 1.5, 2.5, 3.5], bass: true },
  ukg: { kick: [0, 1.75], snare: [1, 3], hat: range(0.5).map((b, i) => (i % 2 ? b + 0.08 : b)), kick2: [0.75, 2.5], snare2: [1, 3], bass: true },
  grime: { kick: [0, 2.75], snare: [2], hat: range(0.5), kick2: [0.5, 1.5], snare2: [2], bass: true },
  dnb: { kick: [0, 2.5], snare: [1, 3], hat: range(0.5) },
  jungle: { kick: [0, 0.5, 2.5], snare: [1, 3, 3.75], hat: range(0.5), kick2: [0, 2.25, 2.5], snare2: [1, 1.75, 3] },
  hiphop: { kick: [0, 0.75, 2.5], snare: [1, 3], hat: range(0.5) },
  breaks: { kick: [0, 2.5], snare: [1, 3], hat: range(0.5) },
};

/** Synthetic drum loop at an exact tempo, with velocity variation. */
export function groove(name: keyof typeof GROOVES, bpm: number, seconds = 90, sampleRate = 44100, seed = 7): PcmSource {
  const g = GROOVES[name];
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const rand = rng(seed);
  const beat = 60 / bpm;
  const addKick = (t: number, v: number) => {
    const i0 = Math.round(t * sampleRate);
    for (let i = 0; i < sampleRate * 0.3 && i0 + i < n; i++) {
      const tt = i / sampleRate;
      const f = 50 + 110 * Math.exp(-tt * 30);
      out[i0 + i] += v * 0.8 * Math.sin(2 * Math.PI * f * tt) * Math.exp(-tt * 10);
    }
  };
  const addNoise = (t: number, dur: number, amp: number, decay: number) => {
    const i0 = Math.round(t * sampleRate);
    for (let i = 0; i < sampleRate * dur && i0 + i < n; i++) {
      out[i0 + i] += amp * (rand() * 2 - 1) * Math.exp(-(i / sampleRate) * decay);
    }
  };
  const bars = Math.floor(seconds / (beat * 4));
  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * beat * 4;
    const second = bar % 2 === 1;
    const kicks = second && g.kick2 ? g.kick2 : g.kick;
    const snares = second && g.snare2 ? g.snare2 : g.snare;
    for (const k of kicks) addKick(t0 + k * beat, 0.8 + rand() * 0.2);
    for (const s of snares) addNoise(t0 + s * beat, 0.2, 0.5 + rand() * 0.15, 16);
    for (const h of g.hat) addNoise(t0 + h * beat, 0.05, 0.12 + rand() * 0.1, 70);
  }
  if (g.bass) {
    // Sustained bass notes changing every 2 beats: energy without sharp onsets.
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const note = Math.floor(t / (beat * 2)) % 4;
      const f = [55, 55, 65.4, 49][note];
      out[i] += 0.15 * Math.sin(2 * Math.PI * f * t);
    }
  }
  return makeSource([out, out], sampleRate);
}

export function sine(freq: number, seconds: number, sampleRate = 44100, amp = 0.5): PcmSource {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return makeSource([out], sampleRate);
}

export function noise(seconds: number, sampleRate = 44100, amp = 0.3): PcmSource {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const r = rng(3);
  for (let i = 0; i < n; i++) out[i] = amp * (r() * 2 - 1);
  return makeSource([out], sampleRate);
}
