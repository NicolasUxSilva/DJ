import type { DeckId } from '../audio/types';

/**
 * Key bindings are data, keyed by physical key (KeyboardEvent.code), so the layout
 * works on any keyboard language and can be remapped later without touching logic.
 */
export type Action =
  | { kind: 'play'; deck: DeckId }
  | { kind: 'cue'; deck: DeckId }
  | { kind: 'loop'; deck: DeckId }
  | { kind: 'loopSize'; deck: DeckId; dir: -1 | 1 }
  | { kind: 'mute'; deck: DeckId }
  | { kind: 'speed'; deck: DeckId; dir: -1 | 1 }
  | { kind: 'bass'; deck: DeckId; dir: -1 | 1 }
  | { kind: 'volume'; deck: DeckId; dir: -1 | 1 }
  | { kind: 'xfade'; dir: -1 | 1 }
  | { kind: 'xfadeCenter' }
  | { kind: 'master'; dir: -1 | 1 }
  | { kind: 'pad'; index: number }
  | { kind: 'recStart' }
  | { kind: 'recStop' }
  | { kind: 'panic' };

export type Group = 'deckA' | 'deckB' | 'mixer' | 'pads' | 'rec' | 'global';

export interface Binding {
  code: string;
  /** Shift layer binding (Shift held). Unshifted bindings also fire with Shift when no shift binding exists. */
  shift?: boolean;
  action: Action;
  group: Group;
  /** Short label for the legend key cap. */
  short: string;
  /** Full description. */
  desc: string;
}

const A: DeckId = 'A';
const B: DeckId = 'B';

export const DEFAULT_BINDINGS: Binding[] = [
  // Deck A — left hand
  { code: 'KeyQ', action: { kind: 'play', deck: A }, group: 'deckA', short: 'PLAY', desc: 'Play / pause Deck A' },
  { code: 'KeyW', action: { kind: 'loop', deck: A }, group: 'deckA', short: 'LOOP', desc: 'Loop on / off Deck A' },
  { code: 'KeyE', action: { kind: 'cue', deck: A }, group: 'deckA', short: 'CUE', desc: 'Cue Deck A (hold to preview)' },
  { code: 'KeyF', action: { kind: 'loopSize', deck: A, dir: -1 }, group: 'deckA', short: 'LOOP ½', desc: 'Halve loop size Deck A' },
  { code: 'KeyG', action: { kind: 'loopSize', deck: A, dir: 1 }, group: 'deckA', short: 'LOOP 2×', desc: 'Double loop size Deck A' },
  { code: 'KeyZ', action: { kind: 'speed', deck: A, dir: -1 }, group: 'deckA', short: 'SPD −', desc: 'Speed down Deck A (hold)' },
  { code: 'KeyX', action: { kind: 'speed', deck: A, dir: 1 }, group: 'deckA', short: 'SPD +', desc: 'Speed up Deck A (hold)' },
  { code: 'KeyC', action: { kind: 'bass', deck: A, dir: -1 }, group: 'deckA', short: 'BASS −', desc: 'Bass down Deck A (hold)' },
  { code: 'KeyV', action: { kind: 'bass', deck: A, dir: 1 }, group: 'deckA', short: 'BASS +', desc: 'Bass up Deck A (hold)' },
  { code: 'KeyC', shift: true, action: { kind: 'volume', deck: A, dir: -1 }, group: 'deckA', short: 'VOL −', desc: 'Volume down Deck A (Shift + C, hold)' },
  { code: 'KeyV', shift: true, action: { kind: 'volume', deck: A, dir: 1 }, group: 'deckA', short: 'VOL +', desc: 'Volume up Deck A (Shift + V, hold)' },
  { code: 'KeyB', action: { kind: 'mute', deck: A }, group: 'deckA', short: 'MUTE', desc: 'Mute Deck A' },

  // Deck B — right hand
  { code: 'KeyO', action: { kind: 'play', deck: B }, group: 'deckB', short: 'PLAY', desc: 'Play / pause Deck B' },
  { code: 'KeyP', action: { kind: 'loop', deck: B }, group: 'deckB', short: 'LOOP', desc: 'Loop on / off Deck B' },
  { code: 'KeyI', action: { kind: 'cue', deck: B }, group: 'deckB', short: 'CUE', desc: 'Cue Deck B (hold to preview)' },
  { code: 'KeyK', action: { kind: 'loopSize', deck: B, dir: -1 }, group: 'deckB', short: 'LOOP ½', desc: 'Halve loop size Deck B' },
  { code: 'KeyL', action: { kind: 'loopSize', deck: B, dir: 1 }, group: 'deckB', short: 'LOOP 2×', desc: 'Double loop size Deck B' },
  { code: 'KeyN', action: { kind: 'speed', deck: B, dir: -1 }, group: 'deckB', short: 'SPD −', desc: 'Speed down Deck B (hold)' },
  { code: 'KeyM', action: { kind: 'speed', deck: B, dir: 1 }, group: 'deckB', short: 'SPD +', desc: 'Speed up Deck B (hold)' },
  { code: 'Comma', action: { kind: 'bass', deck: B, dir: -1 }, group: 'deckB', short: 'BASS −', desc: 'Bass down Deck B (hold)' },
  { code: 'Period', action: { kind: 'bass', deck: B, dir: 1 }, group: 'deckB', short: 'BASS +', desc: 'Bass up Deck B (hold)' },
  { code: 'Comma', shift: true, action: { kind: 'volume', deck: B, dir: -1 }, group: 'deckB', short: 'VOL −', desc: 'Volume down Deck B (Shift + ,  hold)' },
  { code: 'Period', shift: true, action: { kind: 'volume', deck: B, dir: 1 }, group: 'deckB', short: 'VOL +', desc: 'Volume up Deck B (Shift + .  hold)' },
  { code: 'Slash', action: { kind: 'mute', deck: B }, group: 'deckB', short: 'MUTE', desc: 'Mute Deck B' },

  // Crossfader
  { code: 'KeyA', action: { kind: 'xfade', dir: -1 }, group: 'mixer', short: '◀ A', desc: 'Crossfader toward Deck A (hold)' },
  { code: 'KeyS', action: { kind: 'xfadeCenter' }, group: 'mixer', short: 'CENTER', desc: 'Crossfader to center' },
  { code: 'KeyD', action: { kind: 'xfade', dir: 1 }, group: 'mixer', short: 'B ▶', desc: 'Crossfader toward Deck B (hold)' },

  // Pads
  ...Array.from({ length: 9 }, (_, i): Binding => ({
    code: `Digit${i + 1}`,
    action: { kind: 'pad', index: i },
    group: 'pads',
    short: `PAD ${i + 1}`,
    desc: `Drum pad ${i + 1}`,
  })),
  ...Array.from({ length: 9 }, (_, i): Binding => ({
    code: `Numpad${i + 1}`,
    action: { kind: 'pad', index: i },
    group: 'pads',
    short: `PAD ${i + 1}`,
    desc: `Drum pad ${i + 1} (numpad)`,
  })),

  // Recording
  { code: 'KeyR', action: { kind: 'recStart' }, group: 'rec', short: 'REC', desc: 'Start recording' },
  { code: 'KeyT', action: { kind: 'recStop' }, group: 'rec', short: 'STOP', desc: 'Stop recording' },

  // Global
  { code: 'Minus', action: { kind: 'master', dir: -1 }, group: 'global', short: 'MSTR −', desc: 'Master volume down (hold)' },
  { code: 'Equal', action: { kind: 'master', dir: 1 }, group: 'global', short: 'MSTR +', desc: 'Master volume up (hold)' },
  { code: 'Escape', action: { kind: 'panic' }, group: 'global', short: 'STOP ALL', desc: 'Emergency stop: cut every deck and pad' },
];

export function findBinding(bindings: Binding[], code: string, shift: boolean): Binding | undefined {
  if (shift) {
    const s = bindings.find((b) => b.code === code && b.shift);
    if (s) return s;
  }
  return bindings.find((b) => b.code === code && !b.shift);
}

/** US-layout labels for codes, used by the legend (overridden by the real layout when the browser exposes it). */
export const CODE_LABELS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '−',
  Equal: '=',
  Escape: 'esc',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
  ShiftLeft: 'shift',
};

export function labelForCode(code: string, layout?: Map<string, string> | null): string {
  if (layout?.has(code) && /^(Key|Digit)/.test(code)) return layout.get(code)!.toUpperCase();
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return code.slice(6);
  return layout?.get(code) ?? CODE_LABELS[code] ?? code;
}
