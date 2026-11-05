/** Micro fade applied whenever a deck voice starts/stops/jumps, to avoid clicks. */
export const DECLICK = 0.006;
/** Time constant for parameter smoothing (setTargetAtTime). */
export const SMOOTH = 0.012;

export const BASS_MIN_DB = -26;
export const BASS_MAX_DB = 6;
export const BASS_FREQ = 160;

export const SPEED_RANGES = [0.08, 0.16, 0.5] as const;

export interface LoopSize {
  beats: number;
  label: string;
}

/** Loop lengths. Without BPM a beat is treated as 0.5 s (time-based loops). */
export const LOOP_SIZES: readonly LoopSize[] = [
  { beats: 0.25, label: '1/4 BEAT' },
  { beats: 0.5, label: '1/2 BEAT' },
  { beats: 1, label: '1 BEAT' },
  { beats: 2, label: '2 BEATS' },
  { beats: 4, label: '1 BAR' },
  { beats: 8, label: '2 BARS' },
  { beats: 16, label: '4 BARS' },
];
export const DEFAULT_LOOP_INDEX = 4;
export const FALLBACK_BEAT_SECONDS = 0.5;

export function loopSeconds(index: number, bpm: number | null): number {
  const size = LOOP_SIZES[Math.max(0, Math.min(LOOP_SIZES.length - 1, index))];
  return size.beats * (bpm ? 60 / bpm : FALLBACK_BEAT_SECONDS);
}

export function loopLabel(index: number, bpm: number | null): string {
  if (bpm) return LOOP_SIZES[index].label;
  const s = loopSeconds(index, null);
  return `${s < 1 ? s.toFixed(3).replace(/0+$/, '') : s.toFixed(0)} SEC`;
}

/** Fader position (0..1) → linear gain. Audio taper so the travel feels even. */
export function faderGain(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return c * c;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
