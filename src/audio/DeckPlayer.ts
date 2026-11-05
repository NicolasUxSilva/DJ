import { computeWaveform, detectBpm, findFirstSound, snapToZeroCrossing, type TempoRange, type WaveformData } from './analysis';
import {
  BASS_FREQ,
  BASS_MAX_DB,
  BASS_MIN_DB,
  DECLICK,
  DEFAULT_LOOP_INDEX,
  LOOP_SIZES,
  SMOOTH,
  clamp,
  faderGain,
  loopSeconds,
} from './constants';
import { Transport } from './transport';
import type { DeckId, DeckState, LoopRegion } from './types';

interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  stopping: boolean;
}

export function initialDeckState(id: DeckId): DeckState {
  return {
    id,
    status: 'empty',
    loading: null,
    error: null,
    trackId: 0,
    title: '',
    fileName: '',
    format: '',
    duration: 0,
    sampleRate: 0,
    channels: 0,
    playing: false,
    cuePoint: 0,
    previewing: false,
    loop: null,
    loopIndex: DEFAULT_LOOP_INDEX,
    rate: 1,
    volume: 0.9,
    bassDb: 0,
    muted: false,
    bpm: null,
    bpmSource: null,
    analyzing: false,
  };
}

let trackCounter = 0;

/**
 * One deck: AudioBufferSourceNode playback with click-free starts/stops/jumps,
 * CUE (CDJ style), native sample-accurate loops, rate, volume, bass and mute.
 *
 * Signal path: voices → input → volume → bass (low shelf) → mute → [analyser] → xfade → out
 */
export class DeckPlayer {
  readonly id: DeckId;
  readonly input: GainNode;
  readonly xfade: GainNode;
  readonly analyser: AnalyserNode;
  private readonly volumeNode: GainNode;
  private readonly bassNode: BiquadFilterNode;
  private readonly muteNode: GainNode;
  buffer: AudioBuffer | null = null;
  waveform: WaveformData | null = null;
  state: DeckState;
  private voice: Voice | null = null;
  private readonly t = new Transport();
  private loadToken = 0;

  constructor(
    private readonly ctx: AudioContext,
    id: DeckId,
    destination: AudioNode,
    private readonly onChange: (state: DeckState) => void,
    /** Context time of what is currently reaching the speakers. */
    private readonly heardTime: () => number,
    private readonly tempoRange: () => TempoRange,
  ) {
    this.id = id;
    this.state = initialDeckState(id);
    this.input = ctx.createGain();
    this.volumeNode = ctx.createGain();
    this.volumeNode.gain.value = faderGain(this.state.volume);
    this.bassNode = ctx.createBiquadFilter();
    this.bassNode.type = 'lowshelf';
    this.bassNode.frequency.value = BASS_FREQ;
    this.bassNode.gain.value = 0;
    this.muteNode = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.xfade = ctx.createGain();
    this.input.connect(this.volumeNode).connect(this.bassNode).connect(this.muteNode);
    this.muteNode.connect(this.analyser);
    this.muteNode.connect(this.xfade).connect(destination);
  }

  private emit(partial: Partial<DeckState>) {
    this.state = { ...this.state, ...partial };
    this.onChange(this.state);
  }

  get loaded() {
    return this.buffer !== null;
  }

  /** Current playhead (buffer seconds) at context time `time`. */
  position(time = this.ctx.currentTime): number {
    return this.t.positionAt(time);
  }

  // ───────────────────────── loading ─────────────────────────

  async load(file: File): Promise<boolean> {
    const token = ++this.loadToken;
    this.emit({ loading: file.name, error: null });
    let buffer: AudioBuffer;
    try {
      const data = await file.arrayBuffer();
      buffer = await this.ctx.decodeAudioData(data);
    } catch {
      if (token !== this.loadToken) return false;
      this.emit({
        loading: null,
        status: this.buffer ? 'ready' : 'error',
        error: `Could not decode “${file.name}”. Try MP3, WAV, OGG or M4A.`,
      });
      return false;
    }
    if (token !== this.loadToken) return false;
    this.setBuffer(buffer, file.name);
    return true;
  }

  /** Replace the deck's track with a decoded buffer (also used by demo tracks / tests). */
  setBuffer(buffer: AudioBuffer, fileName: string) {
    this.loadToken++;
    this.stopVoice();
    this.t.playing = false;
    this.buffer = buffer;
    this.waveform = computeWaveform(buffer);
    const cue = findFirstSound(buffer);
    this.t.duration = buffer.duration;
    this.t.anchorPos = cue;
    this.t.loop = null;
    const token = this.loadToken;
    this.emit({
      status: 'ready',
      loading: null,
      error: null,
      trackId: ++trackCounter,
      title: titleFromFileName(fileName),
      fileName,
      format: formatFromFileName(fileName),
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      playing: false,
      previewing: false,
      cuePoint: cue,
      loop: null,
      bpm: null,
      bpmSource: null,
      analyzing: true,
    });
    // Tempo analysis takes a few tens of ms; keep it off the load path.
    setTimeout(() => {
      if (token !== this.loadToken || this.buffer !== buffer) return;
      this.analyzeTempo();
    }, 30);
  }

  analyzeTempo() {
    if (!this.buffer) return;
    const r = detectBpm(this.buffer, this.tempoRange());
    this.emit({ bpm: r ? r.bpm : null, bpmSource: r ? 'auto' : null, analyzing: false });
  }

  // ───────────────────────── transport ─────────────────────────

  togglePlay() {
    if (!this.buffer) return;
    if (this.state.previewing) {
      // PLAY while holding CUE: keep playing after CUE is released.
      this.emit({ previewing: false });
      return;
    }
    if (this.t.playing) this.pause();
    else this.play();
  }

  play() {
    if (!this.buffer || this.t.playing) return;
    let pos = this.t.anchorPos;
    if (pos >= this.t.duration - 0.02) pos = this.state.cuePoint;
    this.startVoice(pos);
    this.emit({ playing: true });
  }

  pause() {
    if (!this.t.playing) return;
    const now = this.ctx.currentTime;
    this.stopVoice(now);
    this.t.stop(now);
    this.emit({ playing: false, previewing: false });
  }

  /** Hard stop used by the emergency stop. */
  stop() {
    this.pause();
  }

  /** CUE pressed (CDJ behaviour). */
  cueDown() {
    if (!this.buffer) return;
    if (this.t.playing && !this.state.previewing) {
      // Playing: jump back to the cue point and pause.
      const now = this.ctx.currentTime;
      this.stopVoice(now);
      this.t.stop(now);
      this.t.anchorPos = this.state.cuePoint;
      this.exitLoopIfOutside(this.state.cuePoint);
      this.emit({ playing: false });
      return;
    }
    if (this.state.previewing) return;
    // Paused: set the cue point here (if moved) and preview while held.
    const pos = this.t.anchorPos;
    const cuePoint = Math.abs(pos - this.state.cuePoint) > 0.005 ? pos : this.state.cuePoint;
    this.exitLoopIfOutside(cuePoint);
    this.startVoice(cuePoint);
    this.emit({ cuePoint, previewing: true, playing: true });
  }

  /** CUE released: a preview returns to the cue point. */
  cueUp() {
    if (!this.state.previewing) return;
    const now = this.ctx.currentTime;
    this.stopVoice(now);
    this.t.stop(now);
    this.t.anchorPos = this.state.cuePoint;
    this.exitLoopIfOutside(this.state.cuePoint);
    this.emit({ previewing: false, playing: false });
  }

  seek(target: number) {
    if (!this.buffer) return;
    const pos = clamp(target, 0, Math.max(0, this.t.duration - 0.001));
    this.exitLoopIfOutside(pos);
    if (this.t.playing) {
      const now = this.ctx.currentTime;
      this.stopVoice(now);
      this.startVoice(pos, now);
    } else {
      this.t.anchorPos = pos;
    }
  }

  // ───────────────────────── mixer params ─────────────────────────

  setRate(rate: number, range: number) {
    const r = clamp(rate, 1 - range, 1 + range);
    if (r === this.t.rate) return;
    const now = this.ctx.currentTime;
    if (this.t.playing) this.t.rebase(now);
    this.t.rate = r;
    if (this.voice) this.voice.src.playbackRate.setValueAtTime(r, now);
    this.emit({ rate: r });
  }

  setVolume(v: number) {
    const vol = clamp(v, 0, 1);
    this.volumeNode.gain.setTargetAtTime(faderGain(vol), this.ctx.currentTime, SMOOTH);
    if (vol !== this.state.volume) this.emit({ volume: vol });
  }

  setBass(db: number) {
    const g = clamp(db, BASS_MIN_DB, BASS_MAX_DB);
    this.bassNode.gain.setTargetAtTime(g, this.ctx.currentTime, SMOOTH);
    if (g !== this.state.bassDb) this.emit({ bassDb: g });
  }

  setMuted(muted: boolean) {
    this.muteNode.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.006);
    if (muted !== this.state.muted) this.emit({ muted });
  }

  setCrossfadeGain(g: number) {
    this.xfade.gain.setTargetAtTime(g, this.ctx.currentTime, 0.008);
  }

  setBpm(bpm: number | null) {
    const v = bpm === null ? null : clamp(Math.round(bpm * 100) / 100, 40, 300);
    this.emit({ bpm: v, bpmSource: v === null ? null : 'manual', analyzing: false });
  }

  // ───────────────────────── loops ─────────────────────────

  toggleLoop() {
    if (this.state.loop) this.exitLoop();
    else this.loopIn();
  }

  /** Start a loop at what is being heard right now, with the selected length. */
  loopIn() {
    const buffer = this.buffer;
    if (!buffer) return;
    const pos = this.t.playing ? this.t.positionAt(Math.min(this.heardTime(), this.ctx.currentTime)) : this.t.anchorPos;
    const len = loopSeconds(this.state.loopIndex, this.state.bpm);
    const start = snapToZeroCrossing(buffer, pos);
    const end = Math.min(this.t.duration, snapToZeroCrossing(buffer, start + len));
    if (end - start < 0.03) return;
    this.applyLoop({ start, end });
  }

  exitLoop() {
    if (!this.t.loop) return;
    const now = this.ctx.currentTime;
    if (this.t.playing) this.t.rebase(now);
    this.t.loop = null;
    if (this.voice) this.voice.src.loop = false;
    this.emit({ loop: null });
  }

  /** Halve (-1) or double (+1) the loop size; resizes an active loop in place. */
  resizeLoop(direction: -1 | 1) {
    const index = clamp(this.state.loopIndex + direction, 0, LOOP_SIZES.length - 1);
    if (index === this.state.loopIndex) return;
    this.emit({ loopIndex: index });
    const loop = this.t.loop;
    const buffer = this.buffer;
    if (!loop || !buffer) return;
    const len = loopSeconds(index, this.state.bpm);
    const end = Math.min(this.t.duration, snapToZeroCrossing(buffer, loop.start + len));
    if (end - loop.start < 0.03) return;
    this.applyLoop({ start: loop.start, end });
  }

  private applyLoop(loop: LoopRegion) {
    const now = this.ctx.currentTime;
    if (this.t.playing) {
      this.t.rebase(now);
      const p = this.t.anchorPos;
      this.t.loop = loop;
      if (p >= loop.end - 0.004) {
        // Playhead already past the new end (loop got shorter): jump, keeping the phase.
        const len = loop.end - loop.start;
        const np = loop.start + ((p - loop.start) % len);
        this.stopVoice(now);
        this.startVoice(np, now);
      } else if (this.voice) {
        const src = this.voice.src;
        src.loopStart = loop.start;
        src.loopEnd = loop.end;
        src.loop = true;
      }
    } else {
      this.t.loop = loop;
      const p = this.t.anchorPos;
      if (p >= loop.end) this.t.anchorPos = loop.start + ((p - loop.start) % (loop.end - loop.start));
    }
    this.emit({ loop });
  }

  private exitLoopIfOutside(pos: number) {
    const loop = this.t.loop;
    if (loop && (pos < loop.start - 0.003 || pos >= loop.end)) {
      this.t.loop = null;
      if (this.voice) this.voice.src.loop = false;
      this.emit({ loop: null });
    }
  }

  // ───────────────────────── voices ─────────────────────────

  private startVoice(pos: number, when = this.ctx.currentTime) {
    const buffer = this.buffer;
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.t.rate;
    const loop = this.t.loop;
    if (loop) {
      src.loopStart = loop.start;
      src.loopEnd = loop.end;
      src.loop = true;
    }
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(1, when + DECLICK);
    src.connect(gain).connect(this.input);
    const voice: Voice = { src, gain, stopping: false };
    src.onended = () => {
      gain.disconnect();
      if (this.voice === voice && !voice.stopping) {
        // Reached the end of the track.
        this.voice = null;
        this.t.playing = false;
        this.t.anchorPos = this.t.duration;
        this.emit({ playing: false, previewing: false });
      }
    };
    src.start(when, clamp(pos, 0, buffer.duration));
    this.voice = voice;
    this.t.start(when, pos);
  }

  private stopVoice(when = this.ctx.currentTime) {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    v.stopping = true;
    const g = v.gain.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(g.value, when);
    g.linearRampToValueAtTime(0, when + DECLICK);
    try {
      v.src.stop(when + DECLICK + 0.004);
    } catch {
      /* already stopped */
    }
  }
}

export function titleFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim() || name;
}

export function formatFromFileName(name: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  return m ? m[1].toUpperCase() : 'AUDIO';
}
