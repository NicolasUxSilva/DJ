import { SMOOTH, clamp, faderGain } from './constants';

export const PAD_COUNT = 9;
const MAX_VOICES_PER_PAD = 8;

interface PadVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
}

export interface PadSlot {
  buffer: AudioBuffer | null;
  gain: GainNode;
  volume: number;
  /** Pads sharing a choke group cut each other off (closed hat chokes open hat). */
  choke: number | null;
  voices: PadVoice[];
}

/**
 * Nine one-shot pads. Every trigger spawns a fresh AudioBufferSourceNode, so hits
 * overlap freely; buffers are decoded up front so triggering is immediate.
 *
 * Signal path: voice → voice gain (choke fades) → pad gain → sampler bus → out
 */
export class Sampler {
  readonly bus: GainNode;
  readonly pads: PadSlot[];

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly onTrigger: (index: number) => void,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = faderGain(0.9);
    this.bus.connect(destination);
    this.pads = Array.from({ length: PAD_COUNT }, () => {
      const gain = ctx.createGain();
      gain.gain.value = faderGain(0.85);
      gain.connect(this.bus);
      return { buffer: null, gain, volume: 0.85, choke: null, voices: [] };
    });
  }

  setBuffer(index: number, buffer: AudioBuffer | null, choke: number | null = null) {
    const pad = this.pads[index];
    if (!pad) return;
    this.chokePad(pad, 0.01);
    pad.buffer = buffer;
    pad.choke = choke;
  }

  trigger(index: number): boolean {
    const pad = this.pads[index];
    if (!pad) return false;
    this.onTrigger(index);
    if (!pad.buffer) return false;
    const now = this.ctx.currentTime;
    if (pad.choke !== null) {
      for (const other of this.pads) if (other !== pad && other.choke === pad.choke) this.chokePad(other, 0.015);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = pad.buffer;
    const gain = this.ctx.createGain();
    src.connect(gain).connect(pad.gain);
    const voice: PadVoice = { src, gain };
    src.onended = () => {
      gain.disconnect();
      const i = pad.voices.indexOf(voice);
      if (i >= 0) pad.voices.splice(i, 1);
    };
    src.start(now);
    pad.voices.push(voice);
    if (pad.voices.length > MAX_VOICES_PER_PAD) {
      const oldest = pad.voices.shift();
      if (oldest) fadeOut(oldest, now, 0.02);
    }
    return true;
  }

  setPadVolume(index: number, v: number) {
    const pad = this.pads[index];
    if (!pad) return;
    pad.volume = clamp(v, 0, 1);
    pad.gain.gain.setTargetAtTime(faderGain(pad.volume), this.ctx.currentTime, SMOOTH);
  }

  setVolume(v: number) {
    this.bus.gain.setTargetAtTime(faderGain(clamp(v, 0, 1)), this.ctx.currentTime, SMOOTH);
  }

  activeVoices(): number {
    return this.pads.reduce((n, p) => n + p.voices.length, 0);
  }

  stopAll() {
    for (const pad of this.pads) this.chokePad(pad, 0.02);
  }

  private chokePad(pad: PadSlot, time: number) {
    const now = this.ctx.currentTime;
    for (const v of pad.voices) fadeOut(v, now, time);
    pad.voices = [];
  }
}

function fadeOut(v: PadVoice, now: number, time: number) {
  const g = v.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + time);
  try {
    v.src.stop(now + time + 0.005);
  } catch {
    /* already stopped */
  }
}
