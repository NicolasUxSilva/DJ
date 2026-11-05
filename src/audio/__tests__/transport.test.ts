import { describe, expect, it } from 'vitest';
import { Transport, wrapIntoLoop } from '../transport';
import { crossfadeGains } from '../crossfade';
import { loopSeconds } from '../constants';

describe('Transport', () => {
  const make = () => {
    const t = new Transport();
    t.duration = 100;
    return t;
  };
  it('advances with the rate and freezes when paused', () => {
    const t = make();
    t.start(10, 5);
    expect(t.positionAt(12)).toBeCloseTo(7);
    t.rebase(12);
    t.rate = 1.5;
    expect(t.positionAt(14)).toBeCloseTo(10);
    const p = t.stop(14);
    expect(p).toBeCloseTo(10);
    expect(t.positionAt(50)).toBeCloseTo(10);
  });
  it('wraps inside a loop like AudioBufferSourceNode', () => {
    const t = make();
    t.start(0, 10);
    t.loop = { start: 10, end: 12 };
    expect(t.positionAt(1)).toBeCloseTo(11);
    expect(t.positionAt(2.5)).toBeCloseTo(10.5);
    expect(t.positionAt(7.25)).toBeCloseTo(11.25);
  });
  it('clamps at the end of the track', () => {
    const t = make();
    t.start(0, 99);
    expect(t.positionAt(5)).toBe(100);
  });
  it('never reports positions before the anchor', () => {
    const t = make();
    t.start(10, 30);
    expect(t.positionAt(9.9)).toBe(30);
  });
  it('wrapIntoLoop leaves positions before the end untouched', () => {
    expect(wrapIntoLoop(5, { start: 10, end: 12 })).toBe(5);
    expect(wrapIntoLoop(12, { start: 10, end: 12 })).toBe(10);
  });
});

describe('crossfadeGains', () => {
  it('smooth curve is constant power and hits the ends', () => {
    for (const x of [-1, -0.5, 0, 0.3, 1]) {
      const [a, b] = crossfadeGains(x, 'smooth');
      expect(a * a + b * b).toBeCloseTo(1);
    }
    expect(crossfadeGains(-1, 'smooth')[1]).toBeCloseTo(0);
    expect(crossfadeGains(1, 'smooth')[0]).toBeCloseTo(0);
    expect(crossfadeGains(0, 'smooth')[0]).toBeCloseTo(Math.SQRT1_2);
  });
  it('cut curve keeps both channels open until the edges', () => {
    expect(crossfadeGains(0, 'cut')).toEqual([1, 1]);
    expect(crossfadeGains(0.8, 'cut')).toEqual([1, 1]);
    expect(crossfadeGains(1, 'cut')[0]).toBe(0);
    expect(crossfadeGains(-1, 'cut')[1]).toBe(0);
  });
});

describe('loopSeconds', () => {
  it('uses BPM when available and 0.5 s beats otherwise', () => {
    expect(loopSeconds(4, 120)).toBeCloseTo(2);
    expect(loopSeconds(4, 140)).toBeCloseTo((4 * 60) / 140);
    expect(loopSeconds(2, null)).toBeCloseTo(0.5);
    expect(loopSeconds(6, null)).toBeCloseTo(8);
  });
});
