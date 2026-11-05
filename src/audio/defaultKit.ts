/**
 * The built-in kit is synthesized at startup with OfflineAudioContext, so the app
 * ships without binary samples and every pad works immediately. Users replace any
 * pad with their own files; their kit is persisted separately (see kitStorage.ts).
 */
export interface KitSound {
  name: string;
  buffer: AudioBuffer;
  choke: number | null;
}

type Builder = (ctx: OfflineAudioContext, noise: AudioBuffer) => void;

interface SoundDef {
  name: string;
  seconds: number;
  choke: number | null;
  build: Builder;
}

const HAT_CHOKE = 1;

function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 1): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return b;
}

function saturator(ctx: BaseAudioContext, drive: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const n = 2048;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

function noiseSource(ctx: OfflineAudioContext, noise: AudioBuffer, when = 0) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.start(when);
  return src;
}

const SOUNDS: SoundDef[] = [
  {
    name: 'KICK',
    seconds: 0.6,
    choke: null,
    build(ctx, noise) {
      const out = ctx.destination;
      const shaper = saturator(ctx, 1.8);
      shaper.connect(out);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(175, 0);
      o.frequency.exponentialRampToValueAtTime(54, 0.07);
      o.frequency.exponentialRampToValueAtTime(42, 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, 0.002);
      g.gain.setTargetAtTime(0, 0.06, 0.11);
      o.connect(g).connect(shaper);
      o.start(0);
      const click = noiseSource(ctx, noise);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.35, 0);
      cg.gain.setTargetAtTime(0, 0.001, 0.003);
      click.connect(hp).connect(cg).connect(out);
    },
  },
  {
    name: 'SNARE',
    seconds: 0.45,
    choke: null,
    build(ctx, noise) {
      const out = ctx.destination;
      const shaper = saturator(ctx, 1.4);
      shaper.connect(out);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(205, 0);
      o.frequency.exponentialRampToValueAtTime(168, 0.1);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.8, 0);
      og.gain.setTargetAtTime(0, 0.004, 0.045);
      o.connect(og).connect(shaper);
      o.start(0);
      const n = noiseSource(ctx, noise);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const pk = ctx.createBiquadFilter();
      pk.type = 'peaking';
      pk.frequency.value = 3800;
      pk.gain.value = 5;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.9, 0);
      ng.gain.setTargetAtTime(0, 0.006, 0.075);
      n.connect(hp).connect(pk).connect(ng).connect(shaper);
    },
  },
  {
    name: 'HAT',
    seconds: 0.14,
    choke: HAT_CHOKE,
    build: (ctx) => metallic(ctx, 0.022),
  },
  {
    name: 'OPEN HAT',
    seconds: 0.7,
    choke: HAT_CHOKE,
    build: (ctx) => metallic(ctx, 0.14),
  },
  {
    name: 'CLAP',
    seconds: 0.5,
    choke: null,
    build(ctx, noise) {
      const n = noiseSource(ctx, noise);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1150;
      bp.Q.value = 1.3;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 450;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      for (const t of [0, 0.011, 0.023]) {
        g.gain.setValueAtTime(1, t);
        g.gain.setTargetAtTime(0.12, t + 0.001, 0.0035);
      }
      g.gain.setValueAtTime(0.95, 0.034);
      g.gain.setTargetAtTime(0, 0.035, 0.07);
      n.connect(bp).connect(hp).connect(g).connect(ctx.destination);
    },
  },
  {
    name: 'PERC',
    seconds: 0.3,
    choke: null,
    build(ctx, noise) {
      const out = ctx.destination;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(720, 0);
      o.frequency.exponentialRampToValueAtTime(540, 0.04);
      const o2 = ctx.createOscillator();
      o2.type = 'triangle';
      o2.frequency.setValueAtTime(1440, 0);
      o2.frequency.exponentialRampToValueAtTime(1080, 0.04);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1, 0);
      g.gain.setTargetAtTime(0, 0.002, 0.035);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.35, 0);
      g2.gain.setTargetAtTime(0, 0.001, 0.015);
      o.connect(g).connect(out);
      o2.connect(g2).connect(out);
      o.start(0);
      o2.start(0);
      const n = noiseSource(ctx, noise);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3200;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.4, 0);
      ng.gain.setTargetAtTime(0, 0.0005, 0.004);
      n.connect(bp).connect(ng).connect(out);
    },
  },
  {
    name: 'VOX',
    seconds: 0.55,
    choke: null,
    build(ctx, noise) {
      const out = ctx.destination;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(196, 0);
      o.frequency.linearRampToValueAtTime(232, 0.12);
      o.frequency.linearRampToValueAtTime(205, 0.42);
      const vib = ctx.createOscillator();
      vib.frequency.value = 5.5;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 3;
      vib.connect(vibGain).connect(o.frequency);
      vib.start(0);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0, 0);
      amp.gain.linearRampToValueAtTime(1, 0.025);
      amp.gain.setValueAtTime(1, 0.24);
      amp.gain.setTargetAtTime(0, 0.24, 0.06);
      o.connect(amp);
      o.start(0);
      // Formant glide "y-ah".
      const formants: Array<[number, number, number, number]> = [
        [300, 760, 9, 1],
        [2250, 1150, 12, 0.6],
        [2950, 2500, 14, 0.3],
      ];
      for (const [f0, f1, q, level] of formants) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(f0, 0);
        bp.frequency.exponentialRampToValueAtTime(f1, 0.13);
        bp.Q.value = q;
        const lg = ctx.createGain();
        lg.gain.value = level * 4;
        amp.connect(bp).connect(lg).connect(out);
      }
      const breath = noiseSource(ctx, noise);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.12, 0);
      bg.gain.setTargetAtTime(0, 0.02, 0.02);
      breath.connect(hp).connect(bg).connect(out);
    },
  },
  {
    name: 'ZAP',
    seconds: 0.5,
    choke: null,
    build(ctx) {
      const out = ctx.destination;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(2600, 0);
      o.frequency.exponentialRampToValueAtTime(70, 0.3);
      const mod = ctx.createOscillator();
      mod.type = 'square';
      mod.frequency.setValueAtTime(90, 0);
      mod.frequency.exponentialRampToValueAtTime(30, 0.3);
      const modGain = ctx.createGain();
      modGain.gain.value = 300;
      mod.connect(modGain).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.9, 0.003);
      g.gain.setTargetAtTime(0, 0.06, 0.09);
      o.connect(g).connect(out);
      o.start(0);
      mod.start(0);
    },
  },
  {
    name: 'SUB',
    seconds: 1.8,
    choke: null,
    build(ctx) {
      const out = ctx.destination;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      lp.connect(out);
      const shaper = saturator(ctx, 2.2);
      shaper.connect(lp);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(98, 0);
      o.frequency.exponentialRampToValueAtTime(49, 0.06);
      o.frequency.setValueAtTime(49, 1.0);
      o.frequency.exponentialRampToValueAtTime(46, 1.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, 0.003);
      g.gain.setTargetAtTime(0, 0.35, 0.42);
      o.connect(g).connect(shaper);
      o.start(0);
    },
  },
];

/** 808-style metallic hat: six square oscillators at inharmonic ratios. */
function metallic(ctx: OfflineAudioContext, decay: number) {
  const sum = ctx.createGain();
  sum.gain.value = 0.25;
  for (const r of [2, 3, 4.16, 5.43, 6.79, 8.21]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 40 * r * 1.6;
    o.connect(sum);
    o.start(0);
  }
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 10000;
  bp.Q.value = 0.9;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(1, 0.001);
  g.gain.setTargetAtTime(0, 0.002, decay);
  sum.connect(bp).connect(hp).connect(g).connect(ctx.destination);
}

function normalize(buffer: AudioBuffer, peak = 0.9) {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > max) max = a;
    }
  }
  if (max < 1e-6) return;
  const k = peak / max;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  // Short fade at the tail so truncated decays never click.
  const fade = Math.min(buffer.length, Math.round(buffer.sampleRate * 0.01));
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  }
}

export const DEFAULT_KIT_NAME = 'RHYTHM 01';
export const DEFAULT_PAD_NAMES = SOUNDS.map((s) => s.name);

export async function renderDefaultKit(sampleRate: number): Promise<KitSound[]> {
  return Promise.all(SOUNDS.map((_, i) => renderDefaultSound(i, sampleRate) as Promise<KitSound>));
}

export async function renderDefaultSound(index: number, sampleRate: number): Promise<KitSound | null> {
  const def = SOUNDS[index];
  if (!def) return null;
  const ctx = new OfflineAudioContext(1, Math.ceil(def.seconds * sampleRate), sampleRate);
  def.build(ctx, noiseBuffer(ctx, def.seconds, 17 + index * 31));
  const buffer = await ctx.startRendering();
  normalize(buffer, def.choke === HAT_CHOKE ? 0.6 : 0.9);
  return { name: def.name, buffer, choke: def.choke };
}
