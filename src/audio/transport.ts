import type { LoopRegion } from './types';

/**
 * Pure playback-position bookkeeping for one deck.
 *
 * An AudioBufferSourceNode cannot report its playhead, so the deck keeps an anchor
 * (context time + buffer position) that is re-based whenever the rate or loop changes.
 * Kept free of Web Audio types so it can be unit tested.
 */
export class Transport {
  playing = false;
  rate = 1;
  /** AudioContext time at which anchorPos was valid. */
  anchorTime = 0;
  /** Buffer position (seconds) at anchorTime, or the paused position. */
  anchorPos = 0;
  loop: LoopRegion | null = null;
  duration = 0;

  positionAt(time: number): number {
    if (!this.playing) return this.anchorPos;
    let p = this.anchorPos + Math.max(0, time - this.anchorTime) * this.rate;
    if (this.loop) p = wrapIntoLoop(p, this.loop);
    return Math.min(p, this.duration);
  }

  /** Move the anchor to `time` without changing the playhead. */
  rebase(time: number): void {
    const p = this.positionAt(time);
    this.anchorPos = p;
    this.anchorTime = time;
  }

  start(time: number, pos: number): void {
    this.playing = true;
    this.anchorTime = time;
    this.anchorPos = pos;
  }

  stop(time: number): number {
    const p = this.positionAt(time);
    this.playing = false;
    this.anchorPos = p;
    return p;
  }
}

/** Mirrors how AudioBufferSourceNode wraps a playhead that passes loopEnd. */
export function wrapIntoLoop(p: number, loop: LoopRegion): number {
  if (p < loop.end) return p;
  const len = loop.end - loop.start;
  if (len <= 0) return loop.start;
  return loop.start + ((p - loop.start) % len);
}
