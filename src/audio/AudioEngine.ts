import { DEFAULT_TEMPO_RANGE, TEMPO_RANGES } from './analysis';
import { SMOOTH, clamp, faderGain } from './constants';
import { crossfadeGains } from './crossfade';
import { DeckPlayer, initialDeckState, titleFromFileName } from './DeckPlayer';
import { DEFAULT_KIT_NAME, DEFAULT_PAD_NAMES, renderDefaultKit, renderDefaultSound } from './defaultKit';
import { Recorder, type Take } from './Recorder';
import { PAD_COUNT, Sampler } from './Sampler';
import type { AppState, DeckId, PadState, Settings, TakeState } from './types';
import { createStore } from '../state/store';
import { DEFAULT_SETTINGS, loadPersisted, savePersisted } from '../state/settings';
import {
  clearStoredKit,
  fromBase64,
  isKitFile,
  loadStoredKit,
  savePad,
  toBase64,
  type KitFile,
  type StoredPad,
} from '../state/kitStorage';

export interface Levels {
  masterL: number;
  masterR: number;
  deckA: number;
  deckB: number;
  low: number;
  /** Limiter gain reduction in dB (≤ 0). */
  reduction: number;
}

/** Decoded audio lives in memory (≈ 23 MB per stereo minute at 48 kHz), so cap track length. */
export const MAX_TRACK_MINUTES = 40;

/** Read a file's duration from its metadata without decoding it (null when unknown). */
function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const done = (v: number | null) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      a.removeAttribute('src');
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 2500);
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null);
    a.src = url;
  });
}

const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|m4a|mp4|aac|flac|aif|aiff|opus|webm)$/i;

export function isAudioFile(f: File) {
  return f.type.startsWith('audio/') || AUDIO_EXT.test(f.name);
}

function initialPads(): PadState[] {
  return Array.from({ length: PAD_COUNT }, (_, index) => ({
    index,
    name: DEFAULT_PAD_NAMES[index] ?? `PAD ${index + 1}`,
    fileName: null,
    volume: 0.85,
    source: 'empty',
    loading: true,
    duration: 0,
  }));
}

function initialState(): AppState {
  const p = loadPersisted();
  return {
    audio: 'suspended',
    sampleRate: 0,
    decks: { A: initialDeckState('A'), B: initialDeckState('B') },
    crossfader: 0,
    masterVolume: p.masterVolume ?? 0.9,
    samplerVolume: p.samplerVolume ?? 0.9,
    pads: initialPads(),
    selectedPad: 0,
    kitName: DEFAULT_KIT_NAME,
    recording: { active: false, startedAt: 0, supported: true, mime: '' },
    takes: [],
    settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
    toast: null,
  };
}

/**
 * The audio engine. Owns the AudioContext and the whole graph:
 *
 *   Deck A voices → vol → bass → mute → xfade A ┐
 *   Deck B voices → vol → bass → mute → xfade B ┼→ mix bus → master vol → limiter ┬→ speakers
 *   Pads → pad gain → sampler bus ──────────────┘                                 ├→ recorder
 *                                                                                  └→ meters
 * UI components read discrete state from `store` and poll positions/levels per frame.
 */
export class AudioEngine {
  readonly store = createStore<AppState>(initialState());
  ctx!: AudioContext;
  decks!: Record<DeckId, DeckPlayer>;
  sampler!: Sampler;
  recorder!: Recorder;
  private mixBus!: GainNode;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private analyserL!: AnalyserNode;
  private analyserR!: AnalyserNode;
  private lowAnalyser!: AnalyserNode;
  private scratch = new Float32Array(2048);
  private takes = new Map<number, Take>();
  private storedPads = new Map<number, StoredPad>();
  private padListeners = new Set<(index: number) => void>();
  private toastTimer = 0;
  private toastId = 0;
  private persistTimer = 0;
  private padSaveTimers = new Map<number, number>();
  private initialized = false;

  get state() {
    return this.store.get();
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const Ctx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) {
      this.store.set({ audio: 'closed' });
      this.toast('This browser does not support the Web Audio API.');
      return;
    }
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.mixBus = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = faderGain(this.state.masterVolume);
    // Brick-wall-ish safety limiter: stops summed decks + pads from clipping the output.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;
    this.mixBus.connect(this.master).connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.recorder = new Recorder(ctx);
    this.limiter.connect(this.recorder.node);

    const split = ctx.createChannelSplitter(2);
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = this.analyserR.fftSize = 2048;
    this.limiter.connect(split);
    split.connect(this.analyserL, 0);
    split.connect(this.analyserR, 1);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 120;
    this.lowAnalyser = ctx.createAnalyser();
    this.lowAnalyser.fftSize = 1024;
    this.limiter.connect(lowpass).connect(this.lowAnalyser);

    const heard = () => this.clock();
    const tempoRange = () => TEMPO_RANGES[this.state.settings.tempoRange] ?? DEFAULT_TEMPO_RANGE;
    const onDeck = (state: AppState['decks'][DeckId]) =>
      this.store.set((s) => ({ decks: { ...s.decks, [state.id]: state } }));
    this.decks = {
      A: new DeckPlayer(ctx, 'A', this.mixBus, onDeck, heard, tempoRange),
      B: new DeckPlayer(ctx, 'B', this.mixBus, onDeck, heard, tempoRange),
    };
    this.sampler = new Sampler(ctx, this.mixBus, (i) => {
      for (const l of this.padListeners) l(i);
    });
    this.sampler.setVolume(this.state.samplerVolume);
    this.applyCrossfader();

    this.store.set({
      sampleRate: ctx.sampleRate,
      audio: ctx.state === 'running' ? 'running' : 'suspended',
      recording: { ...this.state.recording, supported: this.recorder.supported, mime: this.recorder.mime },
    });
    ctx.addEventListener('statechange', () => {
      this.store.set({ audio: ctx.state === 'running' ? 'running' : ctx.state === 'closed' ? 'closed' : 'suspended' });
    });

    // Browsers only start audio after a user gesture.
    const wake = () => this.resume();
    window.addEventListener('pointerdown', wake, { capture: true });
    window.addEventListener('keydown', wake, { capture: true });

    window.addEventListener('beforeunload', (e) => {
      const unsaved = this.recorder.active || this.state.takes.some((t) => !t.downloaded);
      if (unsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    void this.loadKit();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume();
  }

  /** Context time of the audio reaching the speakers right now (for visuals and "what I hear"). */
  clock(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const now = ctx.currentTime;
    if (ctx.state === 'running' && typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime && ts.performanceTime) {
        const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        if (t > 0 && t <= now + 0.05) return Math.min(t, now);
      }
    }
    return Math.max(0, now - (ctx.outputLatency || ctx.baseLatency || 0));
  }

  levels(): Levels {
    const out: Levels = { masterL: 0, masterR: 0, deckA: 0, deckB: 0, low: 0, reduction: 0 };
    if (!this.ctx) return out;
    out.masterL = this.peak(this.analyserL);
    out.masterR = this.peak(this.analyserR);
    out.deckA = this.peak(this.decks.A.analyser);
    out.deckB = this.peak(this.decks.B.analyser);
    out.low = this.rms(this.lowAnalyser);
    out.reduction = this.limiter.reduction;
    return out;
  }

  private peak(a: AnalyserNode) {
    const buf = this.scratch.subarray(0, a.fftSize);
    a.getFloatTimeDomainData(buf);
    let m = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] < 0 ? -buf[i] : buf[i];
      if (v > m) m = v;
    }
    return m;
  }

  private rms(a: AnalyserNode) {
    const buf = this.scratch.subarray(0, a.fftSize);
    a.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // ───────────────────────── decks ─────────────────────────

  async loadDeck(id: DeckId, file: File) {
    if (!this.ctx) return;
    if (!isAudioFile(file)) {
      this.toast(`“${file.name}” is not an audio file.`);
      return;
    }
    const duration = await probeDuration(file);
    if (duration && duration > MAX_TRACK_MINUTES * 60) {
      this.toast(`“${file.name}” is ${Math.round(duration / 60)} min — tracks up to ${MAX_TRACK_MINUTES} min are supported.`);
      return;
    }
    const ok = await this.decks[id].load(file);
    if (ok) this.toast(`DECK ${id} · ${titleFromFileName(file.name)}`);
    else if (this.decks[id].state.error) this.toast(this.decks[id].state.error!);
  }

  togglePlay = (id: DeckId) => this.decks?.[id].togglePlay();
  cueDown = (id: DeckId) => this.decks?.[id].cueDown();
  cueUp = (id: DeckId) => this.decks?.[id].cueUp();
  seek = (id: DeckId, pos: number) => this.decks?.[id].seek(pos);
  toggleLoop = (id: DeckId) => this.decks?.[id].toggleLoop();
  resizeLoop = (id: DeckId, dir: -1 | 1) => this.decks?.[id].resizeLoop(dir);

  setRate(id: DeckId, rate: number) {
    this.decks?.[id].setRate(rate, this.state.settings.speedRange);
  }
  setVolume(id: DeckId, v: number) {
    this.decks?.[id].setVolume(v);
  }
  setBass(id: DeckId, db: number) {
    this.decks?.[id].setBass(db);
  }
  toggleMute(id: DeckId) {
    const d = this.decks?.[id];
    if (d) d.setMuted(!d.state.muted);
  }
  setBpm(id: DeckId, bpm: number | null) {
    this.decks?.[id].setBpm(bpm);
  }

  // ───────────────────────── mixer ─────────────────────────

  setCrossfader(x: number) {
    const v = clamp(x, -1, 1);
    if (v === this.state.crossfader) return;
    this.store.set({ crossfader: v });
    this.applyCrossfader();
  }

  private applyCrossfader() {
    if (!this.decks) return;
    const [a, b] = crossfadeGains(this.state.crossfader, this.state.settings.xfadeCurve);
    this.decks.A.setCrossfadeGain(a);
    this.decks.B.setCrossfadeGain(b);
  }

  setMasterVolume(v: number) {
    const vol = clamp(v, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(faderGain(vol), this.ctx.currentTime, SMOOTH);
    this.store.set({ masterVolume: vol });
    this.persist();
  }

  setSamplerVolume(v: number) {
    const vol = clamp(v, 0, 1);
    this.sampler?.setVolume(vol);
    this.store.set({ samplerVolume: vol });
    this.persist();
  }

  updateSettings(partial: Partial<Settings>) {
    const prev = this.state.settings;
    const settings = { ...prev, ...partial };
    this.store.set({ settings });
    if (partial.xfadeCurve) this.applyCrossfader();
    if (partial.speedRange !== undefined && this.decks) {
      for (const d of Object.values(this.decks)) d.setRate(d.state.rate, settings.speedRange);
    }
    if (partial.tempoRange !== undefined && partial.tempoRange !== prev.tempoRange && this.decks) {
      for (const d of Object.values(this.decks)) if (d.loaded && d.state.bpmSource !== 'manual') d.analyzeTempo();
    }
    this.persist();
  }

  /** Emergency stop: silence every deck and pad immediately. Recording keeps running. */
  panic() {
    if (!this.ctx) return;
    this.decks.A.stop();
    this.decks.B.stop();
    this.sampler.stopAll();
    this.toast('STOP · all sound cut');
  }

  // ───────────────────────── sampler ─────────────────────────

  onPadTrigger(fn: (index: number) => void): () => void {
    this.padListeners.add(fn);
    return () => {
      this.padListeners.delete(fn);
    };
  }

  triggerPad(index: number) {
    this.sampler?.trigger(index);
  }

  selectPad(index: number) {
    if (index !== this.state.selectedPad) this.store.set({ selectedPad: index });
  }

  private setPad(index: number, partial: Partial<PadState>) {
    this.store.set((s) => ({ pads: s.pads.map((p) => (p.index === index ? { ...p, ...partial } : p)) }));
  }

  setPadVolume(index: number, v: number) {
    const vol = clamp(v, 0, 1);
    this.sampler?.setPadVolume(index, vol);
    this.setPad(index, { volume: vol });
    const prev = this.padSaveTimers.get(index);
    if (prev) clearTimeout(prev);
    this.padSaveTimers.set(
      index,
      window.setTimeout(() => {
        const stored = this.storedPads.get(index) ?? { index, volume: vol };
        stored.volume = vol;
        this.storedPads.set(index, stored);
        void savePad(stored);
      }, 400),
    );
  }

  private async loadKit() {
    const sr = this.ctx.sampleRate;
    const [kit, stored] = await Promise.all([renderDefaultKit(sr), loadStoredKit()]);
    kit.forEach((sound, i) => {
      this.sampler.setBuffer(i, sound.buffer, sound.choke);
      this.setPad(i, { name: sound.name, source: 'default', loading: false, duration: sound.buffer.duration, fileName: null });
    });
    for (const p of stored) {
      if (p.index < 0 || p.index >= PAD_COUNT) continue;
      this.storedPads.set(p.index, p);
      this.sampler.setPadVolume(p.index, p.volume);
      this.setPad(p.index, { volume: p.volume });
      if (p.data) {
        try {
          const buffer = await this.ctx.decodeAudioData(p.data.slice(0));
          this.sampler.setBuffer(p.index, buffer, null);
          this.setPad(p.index, { name: p.name ?? `PAD ${p.index + 1}`, fileName: p.fileName ?? null, source: 'user', duration: buffer.duration });
        } catch {
          /* corrupted entry: keep the default sound */
        }
      }
    }
    if (stored.some((p) => p.data)) this.store.set({ kitName: 'CUSTOM' });
  }

  async loadPad(index: number, file: File, quiet = false): Promise<boolean> {
    if (!this.ctx || index < 0 || index >= PAD_COUNT) return false;
    if (!isAudioFile(file)) {
      if (!quiet) this.toast(`“${file.name}” is not an audio file.`);
      return false;
    }
    this.setPad(index, { loading: true });
    try {
      const data = await file.arrayBuffer();
      const buffer = await this.ctx.decodeAudioData(data.slice(0));
      this.sampler.setBuffer(index, buffer, null);
      const name = titleFromFileName(file.name).toUpperCase().slice(0, 18);
      this.setPad(index, { name, fileName: file.name, source: 'user', loading: false, duration: buffer.duration });
      const stored: StoredPad = { index, volume: this.state.pads[index].volume, name, fileName: file.name, mime: file.type, data };
      this.storedPads.set(index, stored);
      void savePad(stored);
      this.store.set({ kitName: 'CUSTOM', selectedPad: index });
      if (!quiet) this.toast(`PAD ${index + 1} · ${name}`);
      return true;
    } catch {
      this.setPad(index, { loading: false });
      this.toast(`Could not decode “${file.name}”.`);
      return false;
    }
  }

  /** Assign several files to consecutive pads (sorted by name), starting at `start`. */
  async loadPadFiles(files: File[], start = 0) {
    const json = files.find((f) => /\.json$/i.test(f.name));
    if (json) {
      await this.importKit(json);
      return;
    }
    const audio = files.filter(isAudioFile).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (audio.length === 0) {
      this.toast('No audio files found.');
      return;
    }
    const n = Math.min(audio.length, PAD_COUNT - start);
    let ok = 0;
    for (let i = 0; i < n; i++) if (await this.loadPad(start + i, audio[i], true)) ok++;
    this.toast(`${ok} sample${ok === 1 ? '' : 's'} loaded${audio.length > n ? ` · ${audio.length - n} skipped (9 pads)` : ''}`);
  }

  /** Put the built-in sound back on a pad. */
  async resetPad(index: number) {
    if (!this.ctx) return;
    const sound = await renderDefaultSound(index, this.ctx.sampleRate);
    if (!sound) return;
    this.sampler.setBuffer(index, sound.buffer, sound.choke);
    this.setPad(index, { name: sound.name, fileName: null, source: 'default', duration: sound.buffer.duration });
    const stored: StoredPad = { index, volume: this.state.pads[index].volume };
    this.storedPads.set(index, stored);
    void savePad(stored);
    if (![...this.storedPads.values()].some((p) => p.data)) this.store.set({ kitName: DEFAULT_KIT_NAME });
  }

  async resetKit() {
    if (!this.ctx) return;
    await clearStoredKit();
    this.storedPads.clear();
    const kit = await renderDefaultKit(this.ctx.sampleRate);
    kit.forEach((sound, i) => {
      this.sampler.setBuffer(i, sound.buffer, sound.choke);
      this.sampler.setPadVolume(i, 0.85);
      this.setPad(i, { name: sound.name, fileName: null, source: 'default', volume: 0.85, duration: sound.buffer.duration });
    });
    this.store.set({ kitName: DEFAULT_KIT_NAME });
    this.toast('Default kit restored');
  }

  exportKit() {
    const file: KitFile = {
      format: 'rhythm-kit',
      version: 1,
      name: this.state.kitName,
      pads: this.state.pads.map((p) => {
        const s = this.storedPads.get(p.index);
        return {
          index: p.index,
          name: p.name,
          volume: p.volume,
          fileName: s?.data ? (s.fileName ?? null) : null,
          mime: s?.data ? (s.mime ?? null) : null,
          data: s?.data ? toBase64(s.data) : null,
        };
      }),
    };
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    download(blob, `rhythm-kit-${stamp()}.json`);
    this.toast('Kit exported');
  }

  async importKit(file: File) {
    let kit: unknown;
    try {
      kit = JSON.parse(await file.text());
    } catch {
      this.toast('Not a RHYTHM kit file.');
      return;
    }
    if (!isKitFile(kit)) {
      this.toast('Not a RHYTHM kit file.');
      return;
    }
    for (const p of kit.pads) {
      if (p.index < 0 || p.index >= PAD_COUNT) continue;
      if (p.data) {
        const blob = new Blob([fromBase64(p.data)], { type: p.mime ?? '' });
        const f = new File([blob], p.fileName ?? `${p.name}.wav`, { type: p.mime ?? '' });
        await this.loadPad(p.index, f, true);
      } else {
        await this.resetPad(p.index);
      }
      this.setPadVolume(p.index, p.volume);
    }
    this.store.set({ kitName: kit.name || 'CUSTOM' });
    this.toast(`Kit loaded · ${kit.name}`);
  }

  // ───────────────────────── recording ─────────────────────────

  startRecording() {
    if (!this.ctx || this.recorder.active) return;
    if (!this.recorder.supported) {
      this.toast('Recording is not supported in this browser.');
      return;
    }
    this.resume();
    if (this.recorder.start()) {
      this.store.set({ recording: { ...this.state.recording, active: true, startedAt: performance.now() } });
    }
  }

  async stopRecording() {
    if (!this.ctx || !this.recorder.active) return;
    this.store.set({ recording: { ...this.state.recording, active: false } });
    const take = await this.recorder.stop();
    if (!take) {
      this.toast('Recording was empty.');
      return;
    }
    this.takes.set(take.id, take);
    const ts: TakeState = {
      id: take.id,
      name: take.name,
      url: take.url,
      mime: take.mime,
      ext: take.ext,
      duration: take.duration,
      size: take.blob.size,
      createdAt: take.createdAt,
      downloaded: false,
    };
    this.store.set((s) => ({ takes: [ts, ...s.takes] }));
    this.toast(`${take.name} saved · ${formatDuration(take.duration)}`);
  }

  async downloadTake(id: number, format: 'native' | 'wav') {
    const take = this.takes.get(id);
    if (!take) return;
    const base = `rhythm-${take.name.toLowerCase().replace(/\s+/g, '-')}-${stamp(take.createdAt)}`;
    if (format === 'wav') {
      this.toast('Rendering WAV…');
      try {
        download(await this.recorder.toWav(take), `${base}.wav`);
      } catch {
        this.toast('WAV export failed in this browser — download the original instead.');
        return;
      }
    } else {
      download(take.blob, `${base}.${take.ext}`);
    }
    this.store.set((s) => ({ takes: s.takes.map((t) => (t.id === id ? { ...t, downloaded: true } : t)) }));
  }

  deleteTake(id: number) {
    const take = this.takes.get(id);
    if (take) URL.revokeObjectURL(take.url);
    this.takes.delete(id);
    this.store.set((s) => ({ takes: s.takes.filter((t) => t.id !== id) }));
  }

  // ───────────────────────── misc ─────────────────────────

  toast(text: string) {
    const id = ++this.toastId;
    this.store.set({ toast: { id, text } });
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      if (this.state.toast?.id === id) this.store.set({ toast: null });
    }, 2800);
  }

  private persist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      const s = this.state;
      savePersisted({ settings: s.settings, masterVolume: s.masterVolume, samplerVolume: s.samplerVolume });
    }, 300);
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function stamp(t = Date.now()) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function formatDuration(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const engine = new AudioEngine();

declare global {
  interface Window {
    rhythm?: AudioEngine;
  }
}
if (typeof window !== 'undefined') window.rhythm = engine;
