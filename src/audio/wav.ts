import type { PcmSource } from './analysis';

/** Encode PCM as a 16- or 24-bit little-endian WAV file. */
export function encodeWav(buffer: PcmSource, bitDepth: 16 | 24 = 16): ArrayBuffer {
  const channels = Math.min(2, buffer.numberOfChannels);
  const bytes = bitDepth / 8;
  const frames = buffer.length;
  const dataSize = frames * channels * bytes;
  const out = new ArrayBuffer(44 + dataSize);
  const v = new DataView(out);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * channels * bytes, true);
  v.setUint16(32, channels * bytes, true);
  v.setUint16(34, bitDepth, true);
  ascii(36, 'data');
  v.setUint32(40, dataSize, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let o = 44;
  const max = bitDepth === 16 ? 0x7fff : 0x7fffff;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      const q = Math.round(s * max);
      if (bitDepth === 16) {
        v.setInt16(o, q, true);
        o += 2;
      } else {
        v.setUint8(o, q & 0xff);
        v.setUint8(o + 1, (q >> 8) & 0xff);
        v.setUint8(o + 2, (q >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return out;
}
