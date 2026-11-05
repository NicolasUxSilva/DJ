import { useEffect, useRef } from 'react';
import { engine } from '../state/controller';
import type { Levels } from '../audio/AudioEngine';

type FrameFn = (now: number, dt: number) => void;

const subscribers = new Set<FrameFn>();
let raf = 0;
let last = 0;
let frame = 0;

function loop(now: number) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
  last = now;
  frame++;
  for (const fn of subscribers) fn(now, dt);
  raf = subscribers.size ? requestAnimationFrame(loop) : 0;
}

/** Shared requestAnimationFrame loop for all per-frame visuals (positions, meters, logo). */
export function useFrame(fn: FrameFn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const f: FrameFn = (now, dt) => ref.current(now, dt);
    subscribers.add(f);
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
    return () => {
      subscribers.delete(f);
    };
  }, []);
}

let levelsFrame = -1;
let levelsCache: Levels = { masterL: 0, masterR: 0, deckA: 0, deckB: 0, low: 0, reduction: 0 };

/** Audio levels, read from the analysers at most once per animation frame. */
export function frameLevels(): Levels {
  if (levelsFrame !== frame) {
    levelsFrame = frame;
    levelsCache = engine.levels();
  }
  return levelsCache;
}
