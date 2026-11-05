import { describe, expect, it } from 'vitest';
import { computeWaveform, detectBpm, findFirstSound, snapToZeroCrossing } from '../analysis';
import { groove, makeSource, noise, sine } from './synth';

describe('detectBpm', () => {
  const cases: Array<[Parameters<typeof groove>[0], number]> = [
    ['house', 124],
    ['house', 128],
    ['ukg', 132],
    ['ukg', 135],
    ['grime', 140],
    ['breaks', 126],
    ['breaks', 132],
    ['jungle', 160],
    ['jungle', 170],
    ['dnb', 174],
    ['hiphop', 92],
  ];
  for (const [style, bpm] of cases) {
    it(`finds ${bpm} BPM (${style})`, () => {
      const r = detectBpm(groove(style, bpm));
      expect(r).not.toBeNull();
      expect(Math.abs(r!.bpm - bpm)).toBeLessThan(0.15);
    });
  }

  it('folds into the requested tempo range', () => {
    const r = detectBpm(groove('hiphop', 85), [70, 140]);
    expect(r!.bpm).toBeCloseTo(85, 0);
    const r2 = detectBpm(groove('hiphop', 85), [90, 180]);
    expect(r2!.bpm).toBeCloseTo(170, 0);
  });

  it('is stable with a different random seed', () => {
    const r = detectBpm(groove('jungle', 172, 60, 48000, 99));
    expect(Math.abs(r!.bpm - 172)).toBeLessThan(0.15);
  });

  it('returns null for a steady tone, noise and silence', () => {
    expect(detectBpm(sine(220, 30))).toBeNull();
    expect(detectBpm(sine(55, 30))).toBeNull();
    expect(detectBpm(noise(30))).toBeNull();
    expect(detectBpm(makeSource([new Float32Array(44100 * 20)], 44100))).toBeNull();
  });
});

describe('computeWaveform', () => {
  it('produces normalized buckets at the requested rate', () => {
    const w = computeWaveform(sine(80, 2, 44100, 0.4), 100);
    expect(w.length).toBe(200);
    expect(Math.max(...w.full)).toBe(255);
    // An 80 Hz tone lives in the low band.
    expect(w.low[100]).toBeGreaterThan(150);
  });
});

describe('snapToZeroCrossing', () => {
  it('lands on a rising zero crossing near the target', () => {
    const src = sine(440, 1, 48000);
    const t = snapToZeroCrossing(src, 0.2034);
    const d = src.getChannelData(0);
    const i = Math.round(t * 48000);
    expect(Math.abs(t - 0.2034)).toBeLessThanOrEqual(0.0025);
    expect(d[i - 1]).toBeLessThanOrEqual(0);
    expect(d[i]).toBeGreaterThan(0);
  });
  it('returns the original time when there is no crossing nearby', () => {
    const src = makeSource([new Float32Array(48000).fill(0.5)], 48000);
    expect(snapToZeroCrossing(src, 0.5)).toBe(0.5);
  });
});

describe('findFirstSound', () => {
  it('skips leading silence', () => {
    const d = new Float32Array(44100 * 3);
    for (let i = 44100; i < d.length; i++) d[i] = 0.3 * Math.sin(i / 10);
    const t = findFirstSound(makeSource([d], 44100));
    expect(t).toBeGreaterThan(0.98);
    expect(t).toBeLessThan(1.01);
  });
});
