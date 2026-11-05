/**
 * Offline analysis of decoded tracks: waveform peaks, tempo estimate,
 * zero-crossing snapping for click-free loops and auto-cue.
 *
 * Works on a minimal AudioBuffer-like shape so it can be unit tested in Node.
 */
export interface PcmSource {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface WaveformData {
  /** Buckets per second of buffer time. */
  rate: number;
  length: number;
  /** Peak amplitude per bucket, full band, 0..255 (normalized to track peak). */
  full: Uint8Array;
  /** Peak amplitude per bucket of the low band (< ~180 Hz), same scale. */
  low: Uint8Array;
}

export const WAVEFORM_RATE = 200;

export function computeWaveform(buffer: PcmSource, rate = WAVEFORM_RATE): WaveformData {
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const hop = sr / rate;
  const len = Math.max(1, Math.ceil(n / hop));
  const full = new Float32Array(len);
  const low = new Float32Array(len);
  const a = 1 - Math.exp((-2 * Math.PI * 180) / sr);
  let l1 = 0;
  let l2 = 0;
  let b = 0;
  let next = hop;
  let mf = 0;
  let ml = 0;
  let maxFull = 1e-6;
  for (let i = 0; i < n; i++) {
    const sl = L[i];
    const sr2 = R[i];
    const al = sl < 0 ? -sl : sl;
    const ar = sr2 < 0 ? -sr2 : sr2;
    const af = al > ar ? al : ar;
    l1 += a * ((sl + sr2) * 0.5 - l1);
    l2 += a * (l1 - l2);
    const alow = l2 < 0 ? -l2 : l2;
    if (af > mf) mf = af;
    if (alow > ml) ml = alow;
    if (i + 1 >= next) {
      if (b < len) {
        full[b] = mf;
        low[b] = ml;
      }
      if (mf > maxFull) maxFull = mf;
      b++;
      next += hop;
      mf = 0;
      ml = 0;
    }
  }
  if (b < len) {
    full[b] = mf;
    low[b] = ml;
    if (mf > maxFull) maxFull = mf;
  }
  const qFull = new Uint8Array(len);
  const qLow = new Uint8Array(len);
  const k = 255 / maxFull;
  for (let i = 0; i < len; i++) {
    qFull[i] = Math.min(255, Math.round(full[i] * k));
    // The low band is drawn on top of the full band; a small boost keeps kicks readable.
    qLow[i] = Math.min(255, Math.round(low[i] * k * 1.25));
  }
  return { rate, length: len, full: qFull, low: qLow };
}

export interface TempoEstimate {
  bpm: number;
  confidence: number;
}

export interface TempoWeights {
  half: number;
  one: number;
  two: number;
  four: number;
}
export const TEMPO_WEIGHTS: TempoWeights = { half: 0.5, one: 1, two: 0.5, four: 0.5 };

/** [low, high) — detected tempos are folded by octaves into this range. */
export type TempoRange = readonly [number, number];
export const TEMPO_RANGES: readonly TempoRange[] = [
  [70, 140],
  [90, 180],
  [100, 200],
];
export const DEFAULT_TEMPO_RANGE: TempoRange = TEMPO_RANGES[1];

/**
 * Tempo estimate. Two onset-strength envelopes (lows: kicks/bass, highs: hats/snares)
 * are autocorrelated separately and combined, then every candidate tempo is scored on
 * its half-beat, beat, 2-beat and bar periodicity with a mild log-tempo prior around
 * 125 BPM. Returns null when the material has no clear pulse (pads, tones, silence).
 */
export function detectBpm(
  buffer: PcmSource,
  range: TempoRange = DEFAULT_TEMPO_RANGE,
  weights: TempoWeights = TEMPO_WEIGHTS,
): TempoEstimate | null {
  const minBpm = 70;
  const maxBpm = 190;
  const sr = buffer.sampleRate;
  const hop = Math.max(1, Math.round(sr / 200));
  const fr = sr / hop;
  const segLen = Math.min(buffer.length, Math.round(75 * sr));
  if (segLen < sr * 4) return null;
  // Skip intros: start ~20 % into the track when there is room.
  const start = Math.min(Math.floor(buffer.length * 0.2), buffer.length - segLen);
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;

  const frames = Math.floor(segLen / hop);
  const eLow = new Float32Array(frames);
  const eHigh = new Float32Array(frames);
  const aLow = 1 - Math.exp((-2 * Math.PI * 150) / sr);
  const aMid = 1 - Math.exp((-2 * Math.PI * 2500) / sr);
  // Envelope followers (2-pole) on the squared bands. The low band is smoothed harder so
  // the ripple of sustained bass notes does not look like onsets; highs stay snappy.
  const aEnvLow = 1 - Math.exp((-2 * Math.PI * 10) / sr);
  const aEnvHigh = 1 - Math.exp((-2 * Math.PI * 30) / sr);
  let l1 = 0;
  let l2 = 0;
  let m1 = 0;
  let el1 = 0;
  let el2 = 0;
  let eh1 = 0;
  let eh2 = 0;
  for (let f = 0; f < frames; f++) {
    const base = start + f * hop;
    for (let j = 0; j < hop; j++) {
      const s = (L[base + j] + R[base + j]) * 0.5;
      l1 += aLow * (s - l1);
      l2 += aLow * (l1 - l2);
      m1 += aMid * (s - m1);
      const h = s - m1;
      el1 += aEnvLow * (l2 * l2 - el1);
      el2 += aEnvLow * (el1 - el2);
      eh1 += aEnvHigh * (h * h - eh1);
      eh2 += aEnvHigh * (eh1 - eh2);
    }
    eLow[f] = Math.log(1 + 1000 * el2);
    eHigh[f] = Math.log(1 + 1000 * eh2);
  }

  const lagFor = (bpm: number) => (60 * fr) / bpm;
  const maxLag = Math.ceil(lagFor(minBpm) * 4) + 2;
  if (maxLag >= frames / 2) return null;

  const acLow = onsetAutocorrelation(eLow, maxLag);
  const acHigh = onsetAutocorrelation(eHigh, maxLag);
  if (!acLow && !acHigh) return null;
  const ac = new Float32Array(maxLag + 1);
  const parts = (acLow ? 1 : 0) + (acHigh ? 1 : 0);
  for (let i = 0; i <= maxLag; i++) ac[i] = ((acLow ? acLow[i] : 0) + (acHigh ? acHigh[i] : 0)) / parts;

  // Catmull-Rom interpolation so peaks can sit between integer lags (sub-frame precision).
  const acAt = (x: number) => {
    const i = Math.floor(x);
    const t = x - i;
    if (i < 2 || i + 2 > maxLag) return 0;
    const p0 = ac[i - 1];
    const p1 = ac[i];
    const p2 = ac[i + 1];
    const p3 = ac[i + 2];
    return (
      p1 +
      0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
    );
  };
  const prior = (bpm: number) => {
    const o = Math.log2(bpm / 125) / 0.9;
    return Math.exp(-0.5 * o * o);
  };
  const w = weights;
  const wSum = w.half + w.one + w.two + w.four;
  const score = (bpm: number) => {
    const lag = lagFor(bpm);
    const s = w.half * acAt(lag / 2) + w.one * acAt(lag) + w.two * acAt(lag * 2) + w.four * acAt(lag * 4);
    return (s / wSum) * prior(bpm);
  };

  let best = minBpm;
  let bestScore = -Infinity;
  let total = 0;
  let count = 0;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.1) {
    const s = score(bpm);
    total += Math.max(0, s);
    count++;
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  for (let bpm = best - 0.15; bpm <= best + 0.15; bpm += 0.005) {
    const s = score(bpm);
    if (s > bestScore) {
      bestScore = s;
      best = bpm;
    }
  }
  const avg = total / count;
  const confidence = avg > 0 ? bestScore / avg : 0;
  if (bestScore < 0.12 || confidence < 2) return null;
  // Octave folding: drums alone cannot tell 85 from 170, so fold into the chosen range.
  let bpm = best;
  while (bpm < range[0]) bpm *= 2;
  while (bpm >= range[1]) bpm /= 2;
  // Precision pass at the final octave using long lags (up to 2 bars) only.
  const fine = (b: number) => {
    const lag = lagFor(b);
    let s = 0;
    for (const m of [1, 2, 4, 8]) if (lag * m < maxLag) s += acAt(lag * m);
    return s;
  };
  let refined = bpm;
  let refinedScore = fine(bpm);
  for (let b = bpm - 0.3; b <= bpm + 0.3; b += 0.005) {
    const s = fine(b);
    if (s > refinedScore) {
      refinedScore = s;
      refined = b;
    }
  }
  return { bpm: Math.round(refined * 100) / 100, confidence };
}

/** Normalized autocorrelation of the half-wave rectified energy flux; null when flat. */
function onsetAutocorrelation(energy: Float32Array, maxLag: number): Float32Array | null {
  const n = energy.length;
  const onset = new Float32Array(n);
  let mean = 0;
  let hits = 0;
  // Skip the first 200 ms while the envelope followers settle.
  for (let f = 40; f < n; f++) {
    const d = energy[f] - energy[f - 1];
    const v = d > 0 ? d : 0;
    onset[f] = v;
    mean += v;
    if (v > 0.08) hits++;
  }
  mean /= n;
  // Steady material (tones, pads, silence): no meaningful onsets. Real hits raise the band
  // energy sharply; envelope ripple on a sustained tone stays far below the threshold.
  if (hits < n / 200) return null;
  let variance = 0;
  for (let f = 0; f < n; f++) {
    onset[f] -= mean;
    variance += onset[f] * onset[f];
  }
  variance /= n;
  if (variance < 1e-6) return null;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    const lim = n - lag;
    for (let i = 0; i < lim; i++) s += onset[i] * onset[i + lag];
    ac[lag] = s / lim / variance;
  }
  return ac;
}

/** Nearest rising zero crossing (mono sum) within ±maxShift seconds; keeps loop seams click-free. */
export function snapToZeroCrossing(buffer: PcmSource, time: number, maxShift = 0.0025): number {
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const idx = Math.round(time * sr);
  const win = Math.round(maxShift * sr);
  const mono = (i: number) => L[i] + R[i];
  for (let k = 0; k <= win; k++) {
    const fwd = idx + k;
    if (fwd > 0 && fwd < n && mono(fwd - 1) <= 0 && mono(fwd) > 0) return fwd / sr;
    const back = idx - k;
    if (k > 0 && back > 0 && back < n && mono(back - 1) <= 0 && mono(back) > 0) return back / sr;
  }
  return time;
}

/** First audible moment of the track (auto-cue), in seconds. */
export function findFirstSound(buffer: PcmSource, threshold = 0.004): number {
  const sr = buffer.sampleRate;
  const lim = Math.min(buffer.length, sr * 30);
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  for (let i = 0; i < lim; i++) {
    const a = L[i] < 0 ? -L[i] : L[i];
    const b = R[i] < 0 ? -R[i] : R[i];
    if (a > threshold || b > threshold) return Math.max(0, i / sr - 0.004);
  }
  return 0;
}
