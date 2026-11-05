import { BASS_MAX_DB, BASS_MIN_DB, clamp } from '../audio/constants';
import type { AudioEngine } from '../audio/AudioEngine';
import type { DeckId } from '../audio/types';
import { DEFAULT_BINDINGS, findBinding, type Action, type Binding } from './keymap';
import { createStore, useStore } from './store';

type ContinuousKind = 'speed' | 'bass' | 'volume' | 'master';

/**
 * Continuous controls behave like knobs: a tap moves one fine step, holding keeps
 * moving (after a short delay) and accelerates. Both keys of a pair together reset.
 */
const CONTINUOUS: Record<ContinuousKind, { step: number; delay: number; rate: [number, number] }> = {
  speed: { step: 0.002, delay: 0.22, rate: [0.012, 0.06] },
  bass: { step: 1, delay: 0.1, rate: [20, 36] },
  volume: { step: 0.02, delay: 0.1, rate: [0.6, 1.1] },
  master: { step: 0.02, delay: 0.12, rate: [0.45, 0.8] },
};

interface Held {
  binding: Binding;
  since: number;
  consumed: boolean;
}

export interface PressedState {
  codes: Record<string, true>;
  shift: boolean;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(target.type);
  }
  return false;
}

/**
 * Turns the computer keyboard into the controller.
 * keydown/keyup driven; OS auto-repeat is ignored and continuous controls are
 * animated per frame while their key is held, so faders move like physical faders.
 */
export class KeyboardController {
  bindings: Binding[] = DEFAULT_BINDINGS;
  readonly pressed = createStore<PressedState>({ codes: {}, shift: false });
  private held = new Map<string, Held>();
  private raf = 0;
  private last = 0;
  private xfadeOrder: Array<-1 | 1> = [];
  private xfadeReturn = false;

  constructor(private readonly engine: AudioEngine) {}

  attach(): () => void {
    const down = (e: KeyboardEvent) => this.onKeyDown(e);
    const up = (e: KeyboardEvent) => this.onKeyUp(e);
    const blur = () => this.releaseAll();
    const vis = () => {
      if (document.visibilityState === 'hidden') this.releaseAll();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', vis);
      this.releaseAll();
    };
  }

  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') {
      // macOS drops keyup events for keys released while ⌘ is down: release everything.
      this.releaseAll();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave OS / browser shortcuts alone
    if (isTyping(e.target)) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.setPressed(e.code, true);
      return;
    }
    const binding = findBinding(this.bindings, e.code, e.shiftKey);
    if (!binding) return;
    e.preventDefault();
    if (e.repeat || this.held.has(e.code)) return;
    this.engine.resume();
    const held: Held = { binding, since: performance.now(), consumed: false };
    this.held.set(e.code, held);
    this.setPressed(e.code, true);
    this.press(binding.action, held);
  }

  onKeyUp(e: KeyboardEvent) {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.setPressed(e.code, false);
      return;
    }
    const held = this.held.get(e.code);
    if (!held) return;
    e.preventDefault();
    this.held.delete(e.code);
    this.setPressed(e.code, false);
    this.release(held.binding.action);
  }

  releaseAll() {
    for (const [, h] of this.held) this.release(h.binding.action);
    this.held.clear();
    this.xfadeOrder = [];
    this.pressed.set({ codes: {}, shift: false });
  }

  // ─────────────────────────────────────────────────────────────

  private press(a: Action, held: Held) {
    const en = this.engine;
    switch (a.kind) {
      case 'play':
        return en.togglePlay(a.deck);
      case 'cue':
        return en.cueDown(a.deck);
      case 'loop':
        return en.toggleLoop(a.deck);
      case 'loopSize':
        return en.resizeLoop(a.deck, a.dir);
      case 'mute':
        return en.toggleMute(a.deck);
      case 'pad':
        en.selectPad(a.index);
        return en.triggerPad(a.index);
      case 'recStart':
        return en.startRecording();
      case 'recStop':
        return void en.stopRecording();
      case 'panic':
        return en.panic();
      case 'xfadeCenter':
        this.xfadeReturn = true;
        this.xfadeOrder = [];
        return this.ensureLoop();
      case 'xfade':
        this.xfadeReturn = false;
        this.xfadeOrder = this.xfadeOrder.filter((d) => d !== a.dir);
        this.xfadeOrder.push(a.dir);
        return this.ensureLoop();
      case 'speed':
      case 'bass':
      case 'volume':
      case 'master': {
        const opposite = this.findHeldOpposite(a, held);
        if (opposite) {
          // Both keys of a pair: reset to the neutral value.
          opposite.consumed = true;
          held.consumed = true;
          if (a.kind === 'speed') en.setRate(a.deck, 1);
          if (a.kind === 'bass') en.setBass(a.deck, 0);
          return;
        }
        this.nudge(a, CONTINUOUS[a.kind].step);
        return this.ensureLoop();
      }
    }
  }

  private release(a: Action) {
    if (a.kind === 'cue') this.engine.cueUp(a.deck);
    if (a.kind === 'xfade') this.xfadeOrder = this.xfadeOrder.filter((d) => d !== a.dir);
  }

  private findHeldOpposite(a: Action, self: Held): Held | undefined {
    if (!('dir' in a)) return undefined;
    for (const h of this.held.values()) {
      if (h === self) continue;
      const b = h.binding.action;
      if (b.kind === a.kind && 'dir' in b && b.dir === -a.dir && (!('deck' in a) || ('deck' in b && b.deck === a.deck))) return h;
    }
    return undefined;
  }

  private nudge(a: Action, amount: number) {
    const en = this.engine;
    const s = en.state;
    switch (a.kind) {
      case 'speed': {
        const d = s.decks[a.deck];
        return en.setRate(a.deck, d.rate + a.dir * amount);
      }
      case 'bass': {
        const d = s.decks[a.deck];
        return en.setBass(a.deck, clamp(d.bassDb + a.dir * amount, BASS_MIN_DB, BASS_MAX_DB));
      }
      case 'volume': {
        const d = s.decks[a.deck as DeckId];
        return en.setVolume(a.deck, d.volume + a.dir * amount);
      }
      case 'master':
        return en.setMasterVolume(s.masterVolume + a.dir * amount);
    }
  }

  private ensureLoop() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let active = false;
    const en = this.engine;

    // Crossfader: last pressed direction wins, moves while held.
    const dir = this.xfadeOrder[this.xfadeOrder.length - 1];
    if (dir) {
      active = true;
      const speed = 2 / Math.max(0.05, en.state.settings.xfadeTravel);
      en.setCrossfader(en.state.crossfader + dir * speed * dt);
    } else if (this.xfadeReturn) {
      const x = en.state.crossfader;
      const next = Math.abs(x) < 0.004 ? 0 : x * Math.exp(-dt / 0.045);
      en.setCrossfader(next);
      if (next === 0) this.xfadeReturn = false;
      else active = true;
    }

    for (const h of this.held.values()) {
      const a = h.binding.action;
      if (a.kind !== 'speed' && a.kind !== 'bass' && a.kind !== 'volume' && a.kind !== 'master') continue;
      if (h.consumed) continue;
      active = true;
      const spec = CONTINUOUS[a.kind];
      const t = (now - h.since) / 1000 - spec.delay;
      if (t <= 0) continue;
      const k = Math.min(1, t / 1.2);
      const rate = spec.rate[0] + (spec.rate[1] - spec.rate[0]) * k;
      this.nudge(a, rate * dt);
    }

    this.raf = active ? requestAnimationFrame(this.tick) : 0;
  };

  private setPressed(code: string, on: boolean) {
    const codes = { ...this.pressed.get().codes };
    if (on) codes[code] = true;
    else delete codes[code];
    this.pressed.set({ codes, shift: !!(codes.ShiftLeft || codes.ShiftRight) });
  }

  /** Physical key currently bound to an action (first match), for on-control hints. */
  codeFor(match: (a: Action) => boolean, shift = false): string | null {
    const b = this.bindings.find((x) => !!x.shift === shift && match(x.action) && !x.code.startsWith('Numpad'));
    return b ? b.code : null;
  }
}

export function useKeyPressed(kb: KeyboardController, code: string | null): boolean {
  return useStore(kb.pressed, (s) => (code ? !!s.codes[code] : false));
}
