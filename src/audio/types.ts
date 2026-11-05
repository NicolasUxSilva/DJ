export type DeckId = 'A' | 'B';
export const DECK_IDS: readonly DeckId[] = ['A', 'B'];

export interface LoopRegion {
  /** Loop start in buffer seconds. */
  start: number;
  /** Loop end in buffer seconds (exclusive). */
  end: number;
}

export interface DeckState {
  id: DeckId;
  /** empty: nothing loaded yet · ready: a track is loaded · error: last load failed and nothing is loaded */
  status: 'empty' | 'ready' | 'error';
  /** File name currently being decoded, if any. The previous track keeps playing meanwhile. */
  loading: string | null;
  error: string | null;
  /** Increments on every successful load; lets visuals know the buffer changed. */
  trackId: number;
  title: string;
  fileName: string;
  format: string;
  duration: number;
  sampleRate: number;
  channels: number;
  playing: boolean;
  cuePoint: number;
  /** True while CUE is held from a paused state (preview playback). */
  previewing: boolean;
  loop: LoopRegion | null;
  loopIndex: number;
  /** Playback rate, 1 = original speed. Pitch and speed are linked in v1. */
  rate: number;
  /** Channel fader position 0..1. */
  volume: number;
  bassDb: number;
  muted: boolean;
  bpm: number | null;
  bpmSource: 'auto' | 'manual' | null;
  analyzing: boolean;
}

export interface PadState {
  index: number;
  name: string;
  fileName: string | null;
  volume: number;
  source: 'default' | 'user' | 'empty';
  loading: boolean;
  duration: number;
}

export interface TakeState {
  id: number;
  name: string;
  url: string;
  mime: string;
  ext: string;
  duration: number;
  size: number;
  createdAt: number;
  downloaded: boolean;
}

export type CrossfadeCurve = 'smooth' | 'cut';

export interface Settings {
  xfadeCurve: CrossfadeCurve;
  /** Seconds needed to travel the full crossfader (A → B) while a key is held. */
  xfadeTravel: number;
  /** Max deviation of the speed fader, e.g. 0.16 = ±16 %. */
  speedRange: number;
  /** Logo reacts subtly to the low end of the master output. */
  logoMotion: boolean;
  /** Index into TEMPO_RANGES: detected tempos are folded into this octave. */
  tempoRange: number;
}

export interface AppState {
  audio: 'suspended' | 'running' | 'closed';
  sampleRate: number;
  decks: Record<DeckId, DeckState>;
  /** -1 = full Deck A, 0 = center, 1 = full Deck B. */
  crossfader: number;
  masterVolume: number;
  samplerVolume: number;
  pads: PadState[];
  selectedPad: number;
  kitName: string;
  recording: { active: boolean; startedAt: number; supported: boolean; mime: string };
  takes: TakeState[];
  settings: Settings;
  toast: { id: number; text: string } | null;
}
