import { describe, expect, it } from 'vitest';
import { encodeWav } from '../wav';
import { makeSource } from './synth';

describe('encodeWav', () => {
  it('writes a valid 16-bit stereo header and samples', () => {
    const l = new Float32Array([0, 0.5, -0.5, 1]);
    const r = new Float32Array([0, -1, 0.25, 2]);
    const buf = encodeWav(makeSource([l, r], 48000));
    const v = new DataView(buf);
    const str = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(v.getInt16(44 + 4 * 1, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(v.getInt16(44 + 4 * 1 + 2, true)).toBe(-0x7fff);
    // Out-of-range input is clipped, not wrapped.
    expect(v.getInt16(44 + 4 * 3 + 2, true)).toBe(0x7fff);
  });
});
